// Orchestration, MediaWiki client and Edge Function handler tests, with a fake database and a fake Wikipedia.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, load } from './test-ingest-lib.mjs';

const ing = await load('ingest.ts');
const { createFetcher, extractPages, buildUrl, USER_AGENT } = await load('mediawiki.ts');
const { AFL_TEAMS } = await load('parsers/afl.ts');
const { runIngest, processBatch, PAGES_PER_CALL, MIN_CONFIRM_MS, INSERT_COLUMNS, UPDATE_COLUMNS, PROTECTED_COLUMNS, assertSafe, buildWorklist } = ing;

const MIN = 60_000;
const HOUR = 3_600_000;

// ---- fake database: ingest_apply semantics (one atomic call; only the listed columns change) ----
function fakeDb({ leagues, teams, games = [] }) {
  const rows = new Map(games.map((g) => [g.id, { source_rank: 0, pending: null, missing_runs: 0, missing_since: null, ...g }]));
  let n = 1000;
  const log = { applies: [], changes: [], seasons: [], pages: [] };
  const db = {
    leagues: async () => leagues,
    teams: async () => teams,
    existingGames: async (ids, min, max) => [...rows.values()].filter((g) => ids.includes(g.league_id) && g.game_date >= min && g.game_date <= max).map((g) => structuredClone(g)),
    ownedFutureGames: async (title, from) => [...rows.values()].filter((g) => g.source_page === title && g.game_date >= from).map((g) => structuredClone(g)),
    apply: async (ops) => {
      log.applies.push(structuredClone(ops));
      const staged = new Map([...rows].map(([k, v]) => [k, { ...v }]));
      for (const r of ops.inserts) {
        assertSafe(r, INSERT_COLUMNS);
        const dup = [...staged.values()].some((g) => g.league_id === r.league_id && g.home_team_id === r.home_team_id && g.away_team_id === r.away_team_id && g.game_date === r.game_date);
        if (!dup) staged.set(`g${n}`, { id: `g${n++}`, pending: null, missing_runs: 0, missing_since: null, ...r });
      }
      for (const u of ops.updates) {
        assertSafe(u, UPDATE_COLUMNS);
        const { id, ...cols } = u;
        if (!staged.has(id)) throw new Error('update of unknown id');
        Object.assign(staged.get(id), cols);
      }
      for (const c of ops.changes) { if (!staged.has(c.game_id)) throw new Error('change for unknown game'); log.changes.push(c); }
      rows.clear();
      for (const [k, v] of staged) rows.set(k, v);
    },
    hasFutureGames: async (leagueId, from) => [...rows.values()].some((g) => g.league_id === leagueId && g.status === 'scheduled' && g.game_date >= from),
    setLeagueSeason: async (id, season) => { log.seasons.push([id, season]); leagues.find((l) => l.id === id).season = season; },
    setTeamWikiPage: async (id, page) => { log.pages.push([id, page]); teams.find((t) => t.id === id).wiki_page = page; },
    gamesInWindow: async (from, to) => [...rows.values()].filter((g) => (g.kickoff_at && g.kickoff_at >= from && g.kickoff_at <= to) || (g.time_tbc && g.game_date >= from.slice(0, 10) && g.game_date <= to.slice(0, 10))),
  };
  return { db, rows, log };
}
const noPages = async (titles) => new Map(titles.map((t) => [t, false]));
const byDate = (rows, date, venueOrHome) => [...rows.values()].filter((g) => g.game_date === date && (!venueOrHome || g.venue === venueOrHome || g.home_team_id === venueOrHome));

const aflLeagues = [{ id: 'afl', season: '2027' }];
const aflTeams = Object.values(AFL_TEAMS).map((t, i) => ({ id: `T${i}`, league_id: 'afl', name: t.name, short_name: null, wiki_page: t.page }));
const NOW = Date.parse('2027-03-16T20:00:00Z'); // the evening before round 1
const OPENER = 'Wednesday, 17 March (7:30&nbsp;pm)|{{AFL|Syd}}||V|{{AFL|Gee}}||[[Sydney Cricket Ground]]';

function setup({ wikitext = fixture('afl'), games = [] } = {}) {
  const state = { wikitext, revid: 1382991168, now: NOW, fetched: [] };
  const fx = fakeDb({ leagues: aflLeagues, teams: aflTeams, games });
  const deps = {
    db: fx.db, now: () => state.now, pagesExist: noPages,
    fetchPages: async (titles) => { state.fetched.push(titles); return new Map(titles.map((t) => [t, { title: t, revid: state.revid, wikitext: state.wikitext }])); },
  };
  const run = () => runIngest({ mode: 'daily' }, deps);
  return { state, deps, run, ...fx };
}
const edited = (from, to) => { const w = fixture('afl').replace(from, to); assert.notEqual(w, fixture('afl'), 'edit applied'); return w; };

test('worklist: league pages, team pages, en dash seasons, suffixes; nothing for NBA/NHL', () => {
  const leagues = [{ id: 'epl', season: '2026-27' }, { id: 'ncaaf', season: '2026' }, { id: 'ncaab', season: '2026-27' }, { id: 'ucl', season: '2026-27' }, { id: 'nba', season: '2026-27' },
    { id: 'afl', season: '2027' }, { id: 'ipl', season: '2027' }, { id: 'nrl', season: '2027' }, { id: 'mlb', season: '2027' }];
  const mk = (id, league_id, wiki_page) => ({ id, league_id, name: wiki_page, short_name: null, wiki_page });
  const teams = [mk('a', 'epl', 'Arsenal F.C.'), mk('b', 'ncaaf', 'Alabama Crimson Tide football'), mk('c', 'ncaab', "Duke Blue Devils men's basketball"),
    mk('d', 'nba', 'Los Angeles Lakers'), mk('e', 'mlb', 'Los Angeles Dodgers')];
  const titles = buildWorklist(leagues, teams).map((x) => x.title);
  for (const t of ['2026\u201327 Arsenal F.C. season', '2027 Los Angeles Dodgers season', '2027 Indian Premier League', '2027 NRL season results', '2027 AFL season',
    '2026 Alabama Crimson Tide football team', "2026\u201327 Duke Blue Devils men's basketball team", '2026\u201327 UEFA Champions League league phase']) assert.ok(titles.includes(t), t);
  assert.equal(titles.some((t) => /Lakers/.test(t)), false);
});

test('daily: first run inserts every parsed game in one atomic call and writes no game_changes', async () => {
  const t = setup();
  const s = await t.run();
  assert.deepEqual([s.done, s.pagesFetched, s.gamesParsed, s.created, s.changes, s.updated], [true, 1, 135, 135, 0, 0]);
  assert.equal(t.log.applies.length, 1);
  assert.equal(t.rows.size, 135);
  const opener = byDate(t.rows, '2027-03-17', 'Sydney Cricket Ground')[0];
  assert.equal(opener.kickoff_at, '2027-03-17T08:30:00Z');
  assert.deepEqual([opener.source_page, opener.source_rev, opener.source_rank], ['2027 AFL season', 1382991168, 2]);
  assert.deepEqual(s.unmatchedTeams, []);
});

test('a second run, or a new revision with identical games, writes nothing', async () => {
  const t = setup();
  await t.run();
  t.state.revid += 7;
  t.state.now += 6 * HOUR;
  const s = await t.run();
  assert.deepEqual([s.created, s.updated, s.changes], [0, 0, 0]);
  assert.equal(t.log.applies.length, 1);
});

test('a moved date updates the row (no duplicate) and writes a game_date change after 2 runs', async () => {
  const t = setup();
  await t.run();
  const id = byDate(t.rows, '2027-03-17', 'Sydney Cricket Ground')[0].id;
  t.state.wikitext = edited(OPENER, OPENER.replace('Wednesday, 17 March', 'Thursday, 18 March'));
  const s1 = await t.run();
  assert.deepEqual([s1.created, s1.held, s1.changes], [0, 1, 0]);
  assert.equal(t.rows.size, 135, 'no duplicate row');
  assert.equal(t.rows.get(id).game_date, '2027-03-17', 'held, not applied');
  assert.equal(t.rows.get(id).pending.game_date, '2027-03-18');
  t.state.now += 3 * HOUR; // the next game-day run
  const s2 = await t.run();
  assert.equal(s2.created, 0);
  assert.equal(t.rows.size, 135);
  assert.equal(t.rows.get(id).game_date, '2027-03-18');
  assert.equal(t.rows.get(id).pending, null);
  assert.deepEqual(t.log.changes.map((c) => [c.game_id, c.field, c.old_value, c.new_value]), [
    [id, 'kickoff_at', '2027-03-17T08:30:00Z', '2027-03-18T08:30:00Z'],
    [id, 'game_date', '2027-03-17', '2027-03-18'],
  ]);
});

test('a kickoff change needs the same value on two runs, at least MIN_CONFIRM apart', async () => {
  const t = setup();
  await t.run();
  const id = byDate(t.rows, '2027-03-17', 'Sydney Cricket Ground')[0].id;
  t.state.wikitext = edited(OPENER, OPENER.replace('7:30', '7:10'));
  await t.run();
  t.state.now += 5 * MIN; // an immediate re-run (manual dispatch) does not confirm
  await t.run();
  assert.equal(t.log.changes.length, 0);
  assert.equal(t.rows.get(id).kickoff_at, '2027-03-17T08:30:00Z');
  t.state.now += MIN_CONFIRM_MS;
  await t.run();
  assert.deepEqual(t.log.changes.map((c) => [c.field, c.old_value, c.new_value]), [['kickoff_at', '2027-03-17T08:30:00Z', '2027-03-17T08:10:00Z']]);
  assert.equal(t.rows.get(id).kickoff_at, '2027-03-17T08:10:00Z');
});

test('a one-run blip (vandalism, then revert) never reaches game_changes', async () => {
  const t = setup();
  await t.run();
  const id = byDate(t.rows, '2027-03-17', 'Sydney Cricket Ground')[0].id;
  t.state.wikitext = edited(OPENER, OPENER.replace('7:30', '3:00'));
  await t.run();
  assert.ok(t.rows.get(id).pending);
  t.state.wikitext = fixture('afl');
  t.state.now += 3 * HOUR;
  await t.run();
  assert.equal(t.rows.get(id).pending, null);
  assert.equal(t.log.changes.length, 0);
  assert.equal(t.rows.get(id).kickoff_at, '2027-03-17T08:30:00Z');
});

test('time announced later: TBC then a time, written after two runs as kickoff_at + time_tbc', async () => {
  const t = setup({ wikitext: edited('Wednesday, 17 March (7:30&nbsp;pm)', 'Wednesday, 17 March') });
  await t.run();
  const id = byDate(t.rows, '2027-03-17', 'Sydney Cricket Ground')[0].id;
  assert.deepEqual([t.rows.get(id).time_tbc, t.rows.get(id).kickoff_at], [true, null]);
  t.state.wikitext = fixture('afl');
  await t.run();
  t.state.now += 3 * HOUR;
  await t.run();
  assert.deepEqual(t.log.changes.map((c) => c.field).sort(), ['kickoff_at', 'time_tbc']);
});

test('venue edits apply at once; whitespace-only venue edits do nothing', async () => {
  const t = setup();
  await t.run();
  const id = byDate(t.rows, '2027-03-17', 'Sydney Cricket Ground')[0].id;
  t.state.wikitext = edited('||[[Sydney Cricket Ground]]||}}', '||[[Sydney   Cricket   Ground]] ||}}');
  const quiet = await t.run();
  assert.deepEqual([quiet.updated, t.log.changes.length], [0, 0]);
  t.state.wikitext = edited('[[Sydney Cricket Ground]]||}}', '[[Sydney Cricket Ground|SCG]] Annexe||}}');
  await t.run();
  assert.deepEqual(t.log.changes.map((c) => [c.field, c.new_value]), [['venue', 'SCG Annexe']]);
  assert.equal(t.rows.get(id).venue, 'SCG Annexe');
});

test('a game its owner stops listing: postponed only after 2 runs AND 24 h, never deleted, logged', async () => {
  const t = setup();
  await t.run();
  const id = byDate(t.rows, '2027-03-17', 'Sydney Cricket Ground')[0].id;
  t.state.wikitext = edited('{{AFLGame|' + OPENER + '||}}\n', '');
  await t.run();
  assert.deepEqual([t.rows.get(id).status, t.rows.get(id).missing_runs, t.rows.get(id).missing_since], ['scheduled', 1, new Date(NOW).toISOString()]);
  t.state.now += 3 * HOUR;
  const b = await t.run();
  assert.deepEqual([b.vanished, t.rows.get(id).missing_runs, t.rows.get(id).status], [0, 2, 'scheduled'], 'two runs but only 3 h: not yet');
  t.state.now += 22 * HOUR; // 25 h after the first miss
  const c = await t.run();
  assert.equal(c.vanished, 1);
  assert.equal(t.rows.size, 135, 'never deleted');
  assert.equal(t.rows.get(id).status, 'postponed');
  assert.deepEqual(t.log.changes.map((x) => [x.game_id, x.field, x.old_value, x.new_value]), [[id, 'status', 'scheduled', 'postponed']]);
  // it comes back: the page lists it again, and the status returns after two confirming runs
  t.state.wikitext = fixture('afl');
  t.state.now += 3 * HOUR;
  await t.run();
  t.state.now += 3 * HOUR;
  await t.run();
  assert.deepEqual([t.rows.get(id).status, t.rows.get(id).missing_runs, t.rows.get(id).missing_since], ['scheduled', 0, null]);
});

test('a game seen again before 24 h resets the missing clock', async () => {
  const t = setup();
  await t.run();
  const id = byDate(t.rows, '2027-03-17', 'Sydney Cricket Ground')[0].id;
  t.state.wikitext = edited('{{AFLGame|' + OPENER + '||}}\n', '');
  await t.run();
  t.state.wikitext = fixture('afl');
  t.state.now += 3 * HOUR;
  await t.run();
  assert.deepEqual([t.rows.get(id).missing_runs, t.rows.get(id).missing_since], [0, null]);
});

test('mass-vanish guard: more than 3 games gone in one run is skipped for the page, with a warning', async () => {
  const t = setup();
  await t.run();
  const logs = [];
  t.deps.log = (m) => logs.push(m);
  let dropped = 0;
  t.state.wikitext = fixture('afl').split('\n').filter((l) => !(l.startsWith('{{AFLGame|') && dropped++ < 20)).join('\n');
  assert.ok(dropped > 0 && 20 > Math.max(3, 135 * 0.1), '20 of 135 is above max(3, 10%) = 13.5');
  for (let i = 0; i < 3; i++) {
    t.state.now += HOUR; // still before the first dropped game (17 March 00:00 UTC is 4 h away)
    const s = await t.run();
    assert.equal(s.vanished, 0);
    assert.match(s.warnings[0], /mass vanish skipped for "2027 AFL season"/);
  }
  assert.ok([...t.rows.values()].every((g) => g.status === 'scheduled' && g.missing_runs === 0), 'nothing touched');
  assert.equal(t.log.changes.length, 0);
  assert.match(logs[0], /warning: mass vanish/);
});

test('mass-vanish guard is max(3, 10%): a small page can still lose one game, but not most of its games', async () => {
  const teams = ['ars', 'a', 'b', 'c', 'd', 'e'].map((id) => ({ id, league_id: 'epl', name: id === 'ars' ? 'Arsenal' : id.toUpperCase(), short_name: null, wiki_page: id === 'ars' ? 'Arsenal F.C.' : null }));
  const games = ['a', 'b', 'c', 'd', 'e'].map((o, i) => ({ id: `g${i}`, league_id: 'epl', home_team_id: 'ars', away_team_id: o, game_date: `2026-11-${10 + i}`, kickoff_at: null, time_tbc: true, status: 'scheduled', venue: 'Arsenal Ground', broadcast: null, source_page: ARS, source_rev: 1, source_rank: 1 }));
  const build = (list) => {
    const fx = fakeDb({ leagues: [{ id: 'epl', season: '2026-27' }], teams, games: structuredClone(games) });
    const state = { now: Date.parse('2026-11-01T00:00:00Z'), page: eplPage(list.map((o) => fb(`${10 + 'abcde'.indexOf(o)} November 2026`, 'TBC', 'Arsenal', o.toUpperCase())).join('')) };
    const deps = { db: fx.db, pagesExist: noPages, now: () => state.now, fetchPages: async (ts) => new Map(ts.map((x) => [x, { title: x, revid: 5, wikitext: state.page }])) };
    return { fx, state, run: () => runAll(deps) };
  };
  // 5 owned games, 1 gone: 1 <= max(3, 0.5), the guard stays off; postponed after 2 runs and 24 h
  const one = build(['a', 'b', 'c', 'd']);
  assert.deepEqual((await one.run()).warnings, []);
  assert.equal(one.fx.rows.get('g4').missing_runs, 1);
  one.state.now += 25 * HOUR;
  const r2 = await one.run();
  assert.deepEqual([r2.warnings, r2.vanished, one.fx.rows.get('g4').status], [[], 1, 'postponed']);
  // 4 of 5 gone: 4 > max(3, 0.5), the guard trips and nothing is touched
  const four = build(['a']);
  const g = await four.run();
  assert.equal(g.warnings.length, 1);
  assert.ok([...four.fx.rows.values()].every((x) => x.missing_runs === 0 && x.status === 'scheduled'));
});

test('end to end: a CDT-labelled Liga MX game comes out at UTC-6 (Mexico City), not UTC-5', async () => {
  const leagues = [{ id: 'ligamx', season: '2026-27' }];
  const teams = [mkTeam('ligamx-puebla', 'ligamx', 'Puebla', 'Club Puebla'), mkTeam('ligamx-toluca', 'ligamx', 'Toluca', 'Toluca FC')];
  const page = `==Competitions==\n===Apertura 2026===\n====Matches====\n` + fb('3 July 2026', '20:00 [[Central Time Zone|CDT]]', 'Club Puebla', 'Toluca FC');
  const fx = fakeDb({ leagues, teams });
  const deps = { db: fx.db, pagesExist: noPages, now: () => Date.parse('2026-06-01T00:00:00Z'), fetchPages: async (ts) => new Map(ts.map((x) => [x, { title: x, revid: 9, wikitext: page }])) };
  await runAll(deps);
  const [g] = [...fx.rows.values()];
  assert.equal(g.kickoff_at, '2026-07-04T02:00:00Z'); // 20:00 at UTC-6; a plain CDT (UTC-5) would give 01:00Z
});

test('a page that parses to nothing (blanked, template change) postpones nothing', async () => {
  const t = setup();
  await t.run();
  t.state.wikitext = 'This page was blanked.';
  t.state.now += 3 * HOUR;
  await t.run();
  t.state.now += 3 * HOUR;
  const s = await t.run();
  assert.equal(s.vanished, 0);
  assert.ok([...t.rows.values()].every((g) => g.status === 'scheduled' && g.missing_runs === 0));
});

// ---- ownership between pages ----
const fb = (date, time, home, away, score = '') => `{{Football box collapsible\n| date = ${date}\n| time = ${time}\n| team1 = [[${home}]]\n| score = ${score}\n| team2 = [[${away}]]\n| stadium = ${home} Ground\n}}\n`;
const eplPage = (body) => `==Competitions==\n===Premier League===\n====Matches====\n${body}`;
function eplSetup(pages) {
  const leagues = [{ id: 'epl', season: '2026-27' }];
  const teams = [['ars', 'Arsenal F.C.'], ['eve', 'Everton F.C.']].map(([id, wiki_page]) => ({ id, league_id: 'epl', name: wiki_page.replace(' F.C.', ''), short_name: null, wiki_page }));
  const state = { pages, now: Date.parse('2026-10-01T00:00:00Z') };
  const fx = fakeDb({ leagues, teams });
  const deps = { db: fx.db, pagesExist: noPages, now: () => state.now, fetchPages: async (titles) => new Map(titles.map((t) => [t, state.pages[t] ? { title: t, revid: 5, wikitext: state.pages[t] } : null])) };
  return { state, deps, ...fx };
}
const ARS = '2026\u201327 Arsenal F.C. season';
const EVE = '2026\u201327 Everton F.C. season';

test('two pages list one game: the home club page owns it; the other page never overwrites', async () => {
  const t = eplSetup({
    [ARS]: eplPage(fb('24 October 2026', '15:00 BST', 'Arsenal', 'Everton')),
    [EVE]: eplPage(fb('24 October 2026', '12:30 BST', 'Arsenal', 'Everton')),
  });
  const work = [{ title: EVE, leagueSlug: 'epl', teamId: 'eve', season: '2026-27' }, { title: ARS, leagueSlug: 'epl', teamId: 'ars', season: '2026-27' }];
  const ref = { leagues: await t.db.leagues(), teams: await t.db.teams() };
  await processBatch(work, t.deps, ref);
  const [g] = [...t.rows.values()];
  assert.equal(t.rows.size, 1);
  assert.deepEqual([g.source_page, g.source_rank, g.kickoff_at], [ARS, 1, '2026-10-24T14:00:00Z']);
  for (let i = 0; i < 4; i++) { t.state.now += 3 * HOUR; await processBatch(work, t.deps, ref); } // many runs: no flip-flop
  assert.equal([...t.rows.values()][0].kickoff_at, '2026-10-24T14:00:00Z');
  assert.equal(t.log.changes.length, 0);
  // the visitor page alone may insert a game the owner does not list yet ...
  t.state.pages[EVE] = eplPage(fb('24 October 2026', '12:30 BST', 'Arsenal', 'Everton') + fb('2 May 2027', '15:00 BST', 'Everton', 'Arsenal'));
  await processBatch([work[0]], t.deps, ref);
  const may = byDate(t.rows, '2027-05-02')[0];
  assert.deepEqual([may.source_page, may.source_rank], [EVE, 1]); // Everton is the home side there, so rank 1
  // ... and a more senior page takes ownership when it lists the game later
  t.state.pages[ARS] = eplPage(fb('24 October 2026', '15:00 BST', 'Arsenal', 'Everton') + fb('2 May 2027', '15:00 BST', 'Everton', 'Arsenal'));
  await processBatch([work[1]], t.deps, ref);
  assert.equal(byDate(t.rows, '2027-05-02')[0].source_page, EVE, 'equal rank: the first owner keeps it');
});

test('a visitor page inserts at rank 0 and the home club page takes ownership on its next run', async () => {
  const t = eplSetup({ [ARS]: eplPage(''), [EVE]: eplPage(fb('24 October 2026', '12:30 BST', 'Arsenal', 'Everton')) });
  const ref = { leagues: await t.db.leagues(), teams: await t.db.teams() };
  await processBatch([{ title: EVE, leagueSlug: 'epl', teamId: 'eve', season: '2026-27' }], t.deps, ref);
  assert.deepEqual([...t.rows.values()].map((g) => [g.source_page, g.source_rank]), [[EVE, 0]]);
  t.state.pages[ARS] = eplPage(fb('24 October 2026', '15:00 BST', 'Arsenal', 'Everton'));
  await processBatch([{ title: ARS, leagueSlug: 'epl', teamId: 'ars', season: '2026-27' }], t.deps, ref);
  const g = [...t.rows.values()][0];
  assert.deepEqual([g.source_page, g.source_rank], [ARS, 1]);
  assert.equal(g.pending.kickoff_at, '2026-10-24T14:00:00Z', 'new owner\'s different time is held, not applied');
  assert.equal(t.log.changes.length, 0);
});

// ---- safety ----
test('affiliate and sponsor columns are untouchable', async () => {
  const t = setup();
  await t.run();
  for (const g of t.rows.values()) Object.assign(g, { watch_provider: 'Stan', watch_url: 'https://example.test/w', sponsor_text: 'Presented by X' });
  t.state.wikitext = edited(OPENER, OPENER.replace('7:30', '7:00'));
  await t.run();
  t.state.now += 3 * HOUR;
  await t.run();
  for (const ops of t.log.applies) for (const r of [...ops.inserts, ...ops.updates]) for (const p of PROTECTED_COLUMNS) assert.equal(p in r, false, p);
  const g = byDate(t.rows, '2027-03-17', 'Sydney Cricket Ground')[0];
  assert.equal(g.kickoff_at, '2027-03-17T08:00:00Z');
  assert.deepEqual([g.watch_url, g.sponsor_text, g.watch_provider], ['https://example.test/w', 'Presented by X', 'Stan']);
  assert.throws(() => assertSafe({ id: 'x', sponsor_text: 'x' }, UPDATE_COLUMNS), /protected/);
  assert.throws(() => assertSafe({ id: 'x', surprise: 1 }, UPDATE_COLUMNS), /refusing/);
});

test('a stored TV note is kept when Wikipedia has none', async () => {
  const t = setup();
  await t.run();
  const id = byDate(t.rows, '2027-03-17', 'Sydney Cricket Ground')[0].id;
  t.rows.get(id).broadcast = 'Seven';
  t.state.wikitext = edited(OPENER, OPENER.replace('Sydney Cricket Ground', 'Sydney Cricket Ground|SCG'));
  await t.run();
  assert.equal(t.rows.get(id).broadcast, 'Seven');
});

test('unknown teams are reported and skipped; the page is not trusted to postpone anything', async () => {
  const t = setup();
  t.deps.db.teams = async () => aflTeams.filter((x) => x.name !== 'Fremantle');
  const s = await t.run();
  assert.ok(s.gamesDropped > 0);
  assert.deepEqual(s.unmatchedTeams, ['afl:Fremantle']);
  assert.ok(s.created < 135);
});

test('migration 0002: transactional SECURITY DEFINER RPC, empty search_path, service_role only, no affiliate columns', () => {
  const sql = readFileSync(new URL('../supabase/migrations/fanday_0002_ingest.sql', import.meta.url), 'utf8');
  assert.match(sql, /create or replace function fanday\.ingest_apply\(p_inserts jsonb, p_updates jsonb, p_changes jsonb\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /revoke all on function fanday\.ingest_apply\(jsonb, jsonb, jsonb\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function fanday\.ingest_apply\(jsonb, jsonb, jsonb\) to service_role;/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /watch_|tickets_url|sponsor/);
  assert.match(sql, /add column if not exists pending\s+jsonb/);
  assert.match(sql, /add column if not exists missing_since timestamptz/);
  for (const fn of ['ingest_set_league_season(text, text)', 'ingest_set_team_wiki_page(text, text)']) {
    assert.ok(sql.includes(`revoke all on function fanday.${fn} from public, anon, authenticated;`), fn);
    assert.ok(sql.includes(`grant execute on function fanday.${fn} to service_role;`), fn);
  }
  const setters = sql.slice(sql.indexOf('create or replace function fanday.ingest_set_league_season'));
  assert.equal((setters.match(/security definer/g) ?? []).length, 2);
  assert.equal((setters.match(/set search_path = ''/g) ?? []).length, 2);
  assert.equal((setters.match(/\bset\s+(season|wiki_page)\s*=/g) ?? []).length, 2, 'one column each');
  // every column the function writes is one the migration or 0001 defines
  const body = sql.slice(sql.indexOf('create or replace function'));
  for (const c of [...INSERT_COLUMNS, ...UPDATE_COLUMNS].filter((x) => !['id', 'pending'].includes(x))) assert.ok(body.includes(c), c);
});

// ---- season rollover and page discovery ----
async function runAll(deps, mode = 'daily') {
  const all = { rolled: [], pagesFilled: [], pagesMissing: [], warnings: [], vanished: 0, calls: 0 };
  let cursor = 0, r;
  do {
    r = await runIngest({ mode, cursor }, deps);
    cursor = r.nextCursor;
    all.calls++;
    for (const k of ['rolled', 'pagesFilled', 'pagesMissing', 'warnings']) all[k].push(...r[k]);
    all.vanished += r.vanished;
  } while (!r.done);
  return all;
}
const existing = (...titles) => async (ts) => new Map(ts.map((t) => [t, titles.includes(t)]));
function rollSetup({ leagues, teams, games = [], exists }) {
  const fx = fakeDb({ leagues, teams, games });
  const deps = { db: fx.db, now: () => Date.parse('2027-01-10T12:00:00Z'), pagesExist: exists, fetchPages: async (t) => new Map(t.map((x) => [x, null])) };
  return { deps, ...fx };
}
const mkTeam = (id, league_id, name, wiki_page) => ({ id, league_id, name, short_name: null, wiki_page });

test('rollover: a league page that exists for the next season moves leagues.season', async () => {
  const leagues = [{ id: 'ipl', season: '2026' }, { id: 'epl', season: '2026-27' }];
  const t = rollSetup({ leagues, teams: [], exists: existing('2027 Indian Premier League') });
  const s = await runAll(t.deps);
  assert.deepEqual(t.log.seasons, [['ipl', '2027']]);
  assert.deepEqual(s.rolled, ['ipl: 2026 -> 2027']);
  assert.equal(leagues[1].season, '2026-27', 'EPL has no next-season page yet');
});

test('rollover: team pages need at least half of the teams, and only after the current season is over', async () => {
  const leagues = [{ id: 'nfl', season: '2026' }];
  const teams = ['A', 'B', 'C', 'D'].map((n) => mkTeam(`nfl-${n}`, 'nfl', n, n));
  let t = rollSetup({ leagues, teams, exists: existing('2027 A season') }); // 1 of 4
  await runAll(t.deps);
  assert.deepEqual(t.log.seasons, []);
  t = rollSetup({ leagues, teams, exists: existing('2027 A season', '2027 B season') }); // 2 of 4
  await runAll(t.deps);
  assert.deepEqual(t.log.seasons, [['nfl', '2027']]);
  // a game still to be played in the current season blocks the roll
  const live = [{ id: 'g1', league_id: 'nfl', home_team_id: 'nfl-A', away_team_id: 'nfl-B', game_date: '2027-01-17', kickoff_at: null, time_tbc: true, status: 'scheduled', venue: null, broadcast: null, source_page: 'x', source_rev: 1 }];
  leagues[0].season = '2026';
  t = rollSetup({ leagues, teams, games: live, exists: existing('2027 A season', '2027 B season', '2027 C season') });
  await runAll(t.deps);
  assert.deepEqual(t.log.seasons, []);
});

test('rollover accepts hyphen or en dash seasons and keeps the style', async () => {
  const { nextSeason } = await load('sources.ts');
  assert.deepEqual([nextSeason('2026-27'), nextSeason('2026\u201327'), nextSeason('2026'), nextSeason('2099-00'), nextSeason('x')], ['2027-28', '2027\u201328', '2027', '2100-01', null]);
});

test('discover: a team with a null or missing wiki_page is re-checked daily and filled once its page appears', async () => {
  const mk = () => [mkTeam('ligamx-atlante', 'ligamx', 'Atlante', null), mkTeam('ligamx-puebla', 'ligamx', 'Puebla', 'Club Puebla'), mkTeam('ligamx-tijuana', 'ligamx', 'Tijuana', 'Club Tijuana')];
  // today: no page exists, so nothing is written and the teams stay "Schedule coming"
  const teams = mk();
  let t = rollSetup({ leagues: [{ id: 'ligamx', season: '2026-27' }], teams, exists: existing() });
  const first = await runAll(t.deps);
  assert.deepEqual([t.log.pages, first.pagesFilled], [[], []]);
  assert.ok(first.pagesMissing.includes('2026\u201327 Club Puebla season'));
  assert.equal(teams[0].wiki_page, null);
  // later: Atlante's page appears under "Atlante F.C.", Puebla's under its plain name, Tijuana's under the name already stored
  t = rollSetup({ leagues: [{ id: 'ligamx', season: '2026-27' }], teams, exists: existing('2026\u201327 Atlante F.C. season', '2026\u201327 Puebla season', '2026\u201327 Club Tijuana season') });
  const second = await runAll(t.deps);
  assert.deepEqual([...t.log.pages].sort(), [['ligamx-atlante', 'Atlante F.C.'], ['ligamx-puebla', 'Puebla']]);
  assert.equal(second.pagesFilled.length, 2);
  assert.equal(teams[2].wiki_page, 'Club Tijuana', 'an existing page name is left alone');
});

test('discover: an existing page, or next season\'s page for the same team, is never replaced; candidates stay on the same team', async () => {
  const { acceptableCandidate } = ing;
  assert.deepEqual([acceptableCandidate({ name: 'Puebla' }, 'Club Puebla'), acceptableCandidate({ name: 'Puebla' }, 'Pachuca'), acceptableCandidate({ name: 'Atlante' }, 'Atlante F.C.'), acceptableCandidate({ name: 'Atlante' }, 'Atlas F.C.')], [true, false, true, false]);
  const run = async (team, existsList) => {
    const leagues = [{ id: 'ligamx', season: '2026-27' }];
    const t = rollSetup({ leagues, teams: [team], exists: existing(...existsList) });
    await runAll(t.deps);
    return t.log.pages;
  };
  // current page exists: a lower-ranked candidate that also exists changes nothing
  assert.deepEqual(await run(mkTeam('ligamx-puebla', 'ligamx', 'Puebla', 'Club Puebla'), ['2026\u201327 Club Puebla season', '2026\u201327 Puebla season']), []);
  // this season's page is not up yet but next season's is (rollover): same team, keep the name
  assert.deepEqual(await run(mkTeam('ligamx-puebla', 'ligamx', 'Puebla', 'Club Puebla'), ['2027\u201328 Club Puebla season', '2026\u201327 Puebla season']), []);
  // the stored page is gone and the plain name exists: replaced, with the same team's name only
  assert.deepEqual(await run(mkTeam('ligamx-puebla', 'ligamx', 'Puebla', 'Club Puebla'), ['2026\u201327 Puebla season', '2026\u201327 Pachuca season']), [['ligamx-puebla', 'Puebla']]);
  // a page for another team's name is never used
  assert.deepEqual(await run(mkTeam('ligamx-puebla', 'ligamx', 'Puebla', null), ['2026\u201327 Pachuca season', '2026\u201327 Club Pachuca season']), []);
});

test('discover: page filled lets the next run parse it; gameday never runs maintenance', async () => {
  const leagues = [{ id: 'ligamx', season: '2026-27' }];
  const teams = [mkTeam('ligamx-atlante', 'ligamx', 'Atlante', null)];
  let asked = 0;
  const t = rollSetup({ leagues, teams, exists: async (ts) => { asked++; return new Map(ts.map((x) => [x, false])); } });
  const g = await runIngest({ mode: 'gameday' }, t.deps);
  assert.deepEqual([g.planned, asked], [0, 0]);
  const d = await runAll(t.deps);
  assert.ok(d.calls >= 1 && asked > 0);
  // only the two RPC-backed writes exist on the Db interface for this: season and wiki_page
  const writes = Object.keys(t.deps.db).filter((k) => /^set/.test(k)).sort();
  assert.deepEqual(writes, ['setLeagueSeason', 'setTeamWikiPage']);
});

// ---- game-day selection and paging ----
test('gameday: only pages with a game in the next 36 hours (and both clubs\u2019 pages for TBC dates)', async () => {
  const seeded = setup();
  await seeded.run();
  seeded.state.fetched.length = 0;
  const s = await runIngest({ mode: 'gameday' }, seeded.deps);
  assert.equal(s.planned, 1);
  assert.deepEqual(seeded.state.fetched, [['2027 AFL season']]);
  seeded.state.now = Date.parse('2027-09-01T00:00:00Z');
  seeded.state.fetched.length = 0;
  const q = await runIngest({ mode: 'gameday' }, seeded.deps);
  assert.deepEqual([q.planned, q.done, q.pagesFetched, seeded.state.fetched.length], [0, true, 0, 0]);

  const leagues = [{ id: 'nfl', season: '2026' }];
  const teams = ['Kansas City Chiefs', 'Denver Broncos', 'Miami Dolphins'].map((n, i) => ({ id: `N${i}`, league_id: 'nfl', name: n, short_name: null, wiki_page: n }));
  const games = [{ id: 'g1', league_id: 'nfl', home_team_id: 'N0', away_team_id: 'N1', game_date: '2026-09-14', kickoff_at: null, time_tbc: true, status: 'scheduled', venue: 'x', broadcast: null, source_page: '2026 Kansas City Chiefs season', source_rev: 1 }];
  const fx = fakeDb({ leagues, teams, games });
  const fetched = [];
  const deps = { db: fx.db, pagesExist: noPages, now: () => Date.parse('2026-09-13T12:00:00Z'), fetchPages: async (t) => { fetched.push(t); return new Map(t.map((x) => [x, null])); } };
  await runIngest({ mode: 'gameday' }, deps);
  assert.deepEqual(fetched.flat().sort(), ['2026 Denver Broncos season', '2026 Kansas City Chiefs season']);
});

test('paging: at most PAGES_PER_CALL pages per call (Edge Function CPU limit); the cursor resumes the run', async () => {
  assert.ok(PAGES_PER_CALL >= 1 && PAGES_PER_CALL <= 2);
  const leagues = [{ id: 'nfl', season: '2026' }];
  const teams = Array.from({ length: 25 }, (_, i) => ({ id: `N${i}`, league_id: 'nfl', name: `Team ${String(i).padStart(2, '0')}`, short_name: null, wiki_page: `Team ${String(i).padStart(2, '0')}` }));
  const fx = fakeDb({ leagues, teams });
  const sizes = [];
  const deps = { db: fx.db, pagesExist: noPages, now: () => 0, fetchPages: async (t) => { sizes.push(t.length); return new Map(t.map((x) => [x, null])); } };
  let cursor = 0, calls = 0, last;
  do {
    last = await runIngest({ mode: 'daily', cursor }, deps);
    cursor = last.nextCursor;
    calls++;
  } while (!last.done);
  assert.equal(calls, 13);
  assert.ok(sizes.every((n) => n <= PAGES_PER_CALL));
  assert.equal(sizes.reduce((a, b) => a + b, 0), 25);
  assert.equal((await runIngest({ mode: 'daily', league: 'afl' }, deps)).planned, 0);
});

test('team matching: page link first, then name; diacritics and FC suffixes ignored; same league preferred', () => {
  const { indexTeams, resolveTeam, teamKey } = ing;
  assert.equal(teamKey('Arsenal F.C.'), teamKey('Arsenal'));
  assert.equal(teamKey('Atl\u00e9tico Madrid'), 'atletico madrid');
  const idx = indexTeams([
    { id: 'a1', league_id: 'epl', name: 'Arsenal', short_name: 'ARS', wiki_page: 'Arsenal F.C.' },
    { id: 'a2', league_id: 'ucl', name: 'Arsenal', short_name: 'ARS', wiki_page: 'Arsenal F.C.' },
    { id: 'g1', league_id: 'laliga', name: 'Girona', short_name: null, wiki_page: 'Girona FC' },
  ]);
  assert.equal(resolveTeam(idx, { name: 'Arsenal', page: null }, 'ucl'), 'a2');
  assert.equal(resolveTeam(idx, { name: 'Arsenal', page: null }, 'epl'), 'a1');
  assert.equal(resolveTeam(idx, { name: 'Girona', page: 'Girona FC' }, 'ucl'), 'g1');
  assert.equal(resolveTeam(idx, { name: 'Nobody', page: null }, 'epl'), null);
});

// ---- MediaWiki client ----
const apiJson = (extra = {}) => ({
  batchcomplete: '',
  query: {
    normalized: [{ from: '2027_AFL_season', to: '2027 AFL season' }],
    redirects: [{ from: 'Old title', to: '2027 AFL season' }],
    pages: { 123: { pageid: 123, ns: 0, title: '2027 AFL season', revisions: [{ revid: 1382991168, parentid: 1, slots: { main: { contentmodel: 'wikitext', contentformat: 'text/x-wiki', '*': 'WIKITEXT' } } }] }, '-1': { ns: 0, title: 'No such page', missing: '' } },
  },
  ...extra,
});

test('extractPages follows normalisation and redirects and flags missing pages', () => {
  const m = extractPages(apiJson(), ['2027_AFL_season', 'Old title', 'No such page']);
  assert.equal(m.get('2027_AFL_season').revid, 1382991168);
  assert.equal(m.get('Old title').wikitext, 'WIKITEXT');
  assert.equal(m.get('No such page'), null);
});

test('fetcher: descriptive User-Agent, maxlag, batched titles, pause between calls, retry on maxlag', async () => {
  const sleeps = [];
  const seen = [];
  let n = 0;
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), headers: init.headers });
    n++;
    if (n === 1) return new Response(JSON.stringify({ error: { code: 'maxlag', info: 'Waiting for a database server: 7 seconds lagged.' } }), { status: 200, headers: { 'Retry-After': '7' } });
    return new Response(JSON.stringify(apiJson()), { status: 200 });
  };
  const fetchPages = createFetcher({ fetchImpl, sleep: async (ms) => { sleeps.push(ms); }, delayMs: 1000 });
  const out = await fetchPages(['2027 AFL season', 'No such page']);
  assert.equal(out.get('2027 AFL season').revid, 1382991168);
  assert.equal(out.get('No such page'), null);
  assert.deepEqual(sleeps, [7000, 1000]); // first call has no pause; the maxlag retry waits Retry-After, then the usual pause
  await fetchPages(['2027 AFL season']);
  assert.equal(sleeps.length, 3);
  assert.equal(sleeps.at(-1), 1000); // polite pause before the next call
  const u = new URL(seen[0].url);
  assert.equal(u.origin + u.pathname, 'https://en.wikipedia.org/w/api.php');
  assert.equal(u.searchParams.get('maxlag'), '5');
  assert.equal(u.searchParams.get('rvslots'), 'main');
  assert.equal(u.searchParams.get('rvprop'), 'content|ids');
  assert.equal(u.searchParams.get('titles'), '2027 AFL season|No such page');
  assert.equal(seen[0].headers['User-Agent'], USER_AGENT);
  assert.match(USER_AGENT, /^Fanday\/0\.1 \(machinemisha\+fanday@gmail\.com\)$/);
  assert.equal(buildUrl(['a', 'b'], 5).includes('titles=a%7Cb'), true);
});

test('exists(): light existence check, redirects followed, missing and invalid are false, 50 titles per call', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(new URL(String(url)));
    return new Response(JSON.stringify({ query: {
      redirects: [{ from: 'Old', to: 'New' }],
      pages: { 1: { pageid: 1, title: 'New' }, '-1': { title: 'Nope', missing: '' }, '-2': { title: '', invalid: '' } },
    } }), { status: 200 });
  };
  const ex = createFetcher({ fetchImpl, sleep: async () => {} }).exists;
  const out = await ex(['Old', 'Nope', 'Absent']);
  assert.deepEqual([...out], [['Old', true], ['Nope', false], ['Absent', false]]);
  assert.equal(urls[0].searchParams.has('prop'), false, 'no content requested');
  assert.equal(urls[0].searchParams.get('maxlag'), '5');
  urls.length = 0;
  await ex(Array.from({ length: 120 }, (_, i) => `T${i}`));
  assert.equal(urls.length, 3);
});

test('fetcher: follows `continue` and merges the pages', async () => {
  const page = (id, title, withRev) => ({ pageid: id, ns: 0, title, ...(withRev ? { revisions: [{ revid: id, slots: { main: { '*': `TEXT ${title}` } } }] } : {}) });
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(new URL(String(url)));
    const first = urls.length === 1;
    const body = first
      ? { continue: { rvcontinue: '20260101|9', continue: '||' }, query: { pages: { 1: page(1, 'A', true), 2: page(2, 'B', false) } } }
      : { batchcomplete: '', query: { pages: { 2: page(2, 'B', true) } } };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const out = await createFetcher({ fetchImpl, sleep: async () => {} })(['A', 'B']);
  assert.equal(urls.length, 2);
  assert.equal(urls[1].searchParams.get('rvcontinue'), '20260101|9');
  assert.equal(urls[1].searchParams.get('continue'), '||');
  assert.deepEqual([out.get('A').wikitext, out.get('B').wikitext], ['TEXT A', 'TEXT B']);
  const forever = async () => new Response(JSON.stringify({ continue: { continue: '||' }, query: { pages: {} } }), { status: 200 });
  await assert.rejects(createFetcher({ fetchImpl: forever, sleep: async () => {}, maxContinue: 2 })(['A']), /continue/);
});

test('fetcher: gives up after repeated maxlag or server errors', async () => {
  const lag = async () => new Response(JSON.stringify({ error: { code: 'maxlag' } }), { status: 200, headers: { 'Retry-After': '1' } });
  await assert.rejects(createFetcher({ fetchImpl: lag, sleep: async () => {}, maxRetries: 2 })(['x']), /maxlag/);
  const down = async () => new Response('', { status: 503 });
  await assert.rejects(createFetcher({ fetchImpl: down, sleep: async () => {}, maxRetries: 1 })(['x']), /503/);
});

// ---- Edge Function handler (Deno stubbed) ----
test('handler: method, configuration and shared-secret checks', async () => {
  let handler;
  const env = { FANDAY_INGEST_SECRET: 'test-secret-not-real', SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-key-not-real' };
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  const realFetch = globalThis.fetch;
  const rest = [];
  globalThis.fetch = async (url, init) => { rest.push({ url: String(url), headers: init?.headers }); return new Response('[]', { status: 200 }); };
  try {
    await import(new URL('../supabase/functions/fanday-ingest/index.ts', import.meta.url).href);
    const call = (method, headers, body) => handler(new Request('https://f.test/', { method, headers, body }));
    assert.equal((await call('GET', {})).status, 405);
    assert.equal((await call('POST', {})).status, 401);
    assert.equal((await call('POST', { 'x-ingest-secret': 'wrong' })).status, 401);
    assert.equal((await call('POST', { 'x-ingest-secret': 'test-secret-not-real-extra' })).status, 401);
    assert.equal(rest.length, 0, 'no database call before authorization');
    assert.equal((await call('POST', { 'x-ingest-secret': env.FANDAY_INGEST_SECRET }, '{"mode":"hourly"}')).status, 400);
    const ok = await call('POST', { 'x-ingest-secret': env.FANDAY_INGEST_SECRET }, '{"mode":"gameday"}');
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.deepEqual([body.mode, body.done, body.planned], ['gameday', true, 0]);
    assert.ok(rest.some((r) => r.url.startsWith('https://example.test/rest/v1/leagues')), 'the call reaches the database (keeps the project awake)');
    assert.ok(rest.every((r) => r.headers['Accept-Profile'] === 'fanday' && r.headers['Content-Profile'] === 'fanday'), 'every REST call selects the fanday schema');
    delete env.FANDAY_INGEST_SECRET;
    assert.equal((await call('POST', { 'x-ingest-secret': '' })).status, 500, 'fails closed without FANDAY_INGEST_SECRET');
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.Deno;
  }
});
