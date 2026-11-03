// Orchestration, MediaWiki client and Edge Function handler tests, with a fake database and a fake Wikipedia.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, load } from './test-ingest-lib.mjs';

const ing = await load('ingest.ts');
const { createFetcher, extractPages, buildUrl, USER_AGENT } = await load('mediawiki.ts');
const { AFL_TEAMS } = await load('parsers/afl.ts');
const { runIngest, UPSERT_COLUMNS, PROTECTED_COLUMNS, gameKey, assertSafeRow, buildWorklist } = ing;

// ---- fake database: same merge semantics as PostgREST resolution=merge-duplicates ----
function fakeDb({ leagues, teams, games = [] }) {
  const rows = new Map(games.map((g) => [gameKey(g), { ...g }]));
  let nextId = 1000;
  const calls = { upserts: [], changes: [] };
  const db = {
    leagues: async () => leagues,
    teams: async () => teams,
    existingGames: async (ids, min, max) => [...rows.values()].filter((g) => ids.includes(g.league_id) && g.game_date >= min && g.game_date <= max),
    upsertGames: async (batch) => {
      for (const r of batch) {
        assertSafeRow(r);
        calls.upserts.push(r);
        const k = gameKey(r);
        rows.set(k, { id: `g${nextId++}`, ...(rows.get(k) ?? {}), ...r, ...(rows.get(k)?.id ? { id: rows.get(k).id } : {}) });
      }
    },
    insertChanges: async (batch) => { calls.changes.push(...batch); },
    gamesInWindow: async (from, to) => [...rows.values()].filter((g) => (g.kickoff_at && g.kickoff_at >= from && g.kickoff_at <= to) || (g.time_tbc && g.game_date >= from.slice(0, 10) && g.game_date <= to.slice(0, 10))),
  };
  return { db, rows, calls };
}

const aflLeagues = [{ id: 'afl', season: '2027' }];
const aflTeams = Object.values(AFL_TEAMS).map((t, i) => ({ id: `T${i}`, league_id: 'afl', name: t.name, short_name: null, wiki_page: t.page }));
const NOW = Date.parse('2027-03-16T20:00:00Z'); // the evening before round 1

function setup({ wikitext = fixture('afl'), games = [] } = {}) {
  const state = { wikitext, revid: 1382991168, fetched: [] };
  const fx = fakeDb({ leagues: aflLeagues, teams: aflTeams, games });
  const deps = {
    db: fx.db, now: () => NOW,
    fetchPages: async (titles) => { state.fetched.push(titles); return new Map(titles.map((t) => [t, { title: t, revid: state.revid, wikitext: state.wikitext }])); },
  };
  return { state, deps, ...fx };
}

test('worklist: one league page for AFL, team pages for team leagues, nothing for leagues we do not parse', () => {
  const leagues = [...aflLeagues, { id: 'nba', season: '2026-27' }, { id: 'nfl', season: '2026' }];
  const teams = [...aflTeams, { id: 'K', league_id: 'nfl', name: 'Kansas City Chiefs', short_name: 'KC', wiki_page: 'Kansas City Chiefs' }];
  const w = buildWorklist(leagues, teams);
  assert.deepEqual(w.map((x) => x.title), ['2026 Kansas City Chiefs season', '2027 AFL season']);
  assert.equal(w.some((x) => x.leagueSlug === 'nba'), false);
});

test('daily: first run creates every parsed game and writes no game_changes', async () => {
  const t = setup();
  const s = await runIngest({ mode: 'daily' }, t.deps);
  assert.equal(s.done, true);
  assert.equal(s.pagesFetched, 1);
  assert.equal(s.gamesParsed, 135);
  assert.equal(s.created, 135);
  assert.equal(s.upserted, 135);
  assert.equal(s.changes, 0);
  assert.deepEqual(s.unmatchedTeams, []);
  const opener = [...t.rows.values()].find((g) => g.game_date === '2027-03-17' && g.venue === 'Sydney Cricket Ground');
  assert.equal(opener.kickoff_at, '2027-03-17T08:30:00Z');
  assert.equal(opener.source_page, '2027 AFL season');
  assert.equal(opener.source_rev, 1382991168);
  assert.deepEqual(t.state.fetched, [['2027 AFL season']]);
});

test('daily: a second identical run, or a new revision with identical games, writes nothing', async () => {
  const t = setup();
  await runIngest({ mode: 'daily' }, t.deps);
  t.calls.upserts.length = 0;
  t.state.revid += 7; // only source_rev moved
  const s = await runIngest({ mode: 'daily' }, t.deps);
  assert.equal(s.upserted, 0);
  assert.equal(s.changes, 0);
  assert.equal(t.calls.upserts.length, 0);
});

test('a kickoff and venue edit on Wikipedia writes the row and game_changes', async () => {
  const t = setup();
  await runIngest({ mode: 'daily' }, t.deps);
  const before = [...t.rows.values()].find((g) => g.game_date === '2027-03-17');
  t.state.wikitext = fixture('afl').replace(
    'Wednesday, 17 March (7:30&nbsp;pm)|{{AFL|Syd}}||V|{{AFL|Gee}}||[[Sydney Cricket Ground]]',
    'Wednesday, 17 March (7:10&nbsp;pm)|{{AFL|Syd}}||V|{{AFL|Gee}}||[[Sydney Cricket Ground|SCG]] Annexe',
  );
  assert.notEqual(t.state.wikitext, fixture('afl'));
  t.calls.changes.length = 0;
  const s = await runIngest({ mode: 'daily' }, t.deps);
  assert.equal(s.upserted, 1);
  assert.equal(s.created, 0);
  assert.deepEqual(t.calls.changes.map((c) => [c.game_id, c.field, c.old_value, c.new_value]), [
    [before.id, 'kickoff_at', '2027-03-17T08:30:00Z', '2027-03-17T08:10:00Z'],
    [before.id, 'venue', 'Sydney Cricket Ground', 'SCG Annexe'],
  ]);
  assert.ok(t.calls.changes.every((c) => c.detected_at === new Date(NOW).toISOString() && !('pushed_at' in c)));
  assert.equal(t.rows.get(gameKey(before)).kickoff_at, '2027-03-17T08:10:00Z');
});

test('time announced later: TBC row gets its kickoff and two change rows', async () => {
  const noTime = fixture('afl').replace('Wednesday, 17 March (7:30&nbsp;pm)', 'Wednesday, 17 March');
  const t = setup({ wikitext: noTime });
  await runIngest({ mode: 'daily' }, t.deps);
  const row = [...t.rows.values()].find((g) => g.game_date === '2027-03-17');
  assert.deepEqual([row.time_tbc, row.kickoff_at], [true, null]);
  t.state.wikitext = fixture('afl');
  const s = await runIngest({ mode: 'daily' }, t.deps);
  assert.equal(s.changes, 2);
  assert.deepEqual(t.calls.changes.map((c) => c.field).sort(), ['kickoff_at', 'time_tbc']);
});

test('whitespace-only venue edits are ignored', async () => {
  const t = setup();
  await runIngest({ mode: 'daily' }, t.deps);
  t.calls.upserts.length = 0;
  t.state.wikitext = fixture('afl').replace('||[[Sydney Cricket Ground]]||}}', '||[[Sydney   Cricket   Ground]] ||}}');
  const s = await runIngest({ mode: 'daily' }, t.deps);
  assert.equal(s.upserted, 0);
  assert.equal(t.calls.changes.length, 0);
});

test('affiliate and sponsor columns are never written or erased', async () => {
  const t = setup();
  await runIngest({ mode: 'daily' }, t.deps);
  for (const g of t.rows.values()) Object.assign(g, { watch_provider: 'Stan', watch_url: 'https://example.test/w', tickets_url: 'https://example.test/t', sponsor_id: 's1', sponsor_text: 'Presented by X', sponsor_url: 'https://example.test/s' });
  t.state.wikitext = fixture('afl').replace('(7:30&nbsp;pm)|{{AFL|Syd}}', '(7:00&nbsp;pm)|{{AFL|Syd}}');
  await runIngest({ mode: 'daily' }, t.deps);
  for (const r of t.calls.upserts) {
    for (const k of Object.keys(r)) assert.ok(UPSERT_COLUMNS.includes(k), k);
    for (const p of PROTECTED_COLUMNS) assert.equal(p in r, false, p);
  }
  const edited = [...t.rows.values()].find((g) => g.game_date === '2027-03-17');
  assert.equal(edited.kickoff_at, '2027-03-17T08:00:00Z');
  assert.equal(edited.watch_url, 'https://example.test/w');
  assert.equal(edited.sponsor_text, 'Presented by X');
  assert.throws(() => assertSafeRow({ ...t.calls.upserts[0], sponsor_text: 'x' }), /refusing/);
  assert.throws(() => assertSafeRow({ watch_url: 'x' }), /refusing/);
});

test('a stored TV note is kept when Wikipedia has none', async () => {
  const t = setup();
  await runIngest({ mode: 'daily' }, t.deps);
  const row = [...t.rows.values()].find((g) => g.game_date === '2027-03-17');
  row.broadcast = 'Seven';
  t.state.wikitext = fixture('afl').replace('(7:30&nbsp;pm)|{{AFL|Syd}}', '(7:00&nbsp;pm)|{{AFL|Syd}}');
  await runIngest({ mode: 'daily' }, t.deps);
  assert.equal(t.rows.get(gameKey(row)).broadcast, 'Seven');
});

test('unknown teams are reported, not guessed', async () => {
  const t = setup();
  t.deps.db.teams = async () => aflTeams.filter((x) => x.name !== 'Fremantle');
  const s = await runIngest({ mode: 'daily' }, t.deps);
  assert.ok(s.gamesDropped > 0);
  assert.deepEqual(s.unmatchedTeams, ['afl:Fremantle']);
  assert.ok(s.created < 135);
});

test('gameday: only pages with a game in the next 36 hours', async () => {
  const seeded = setup();
  await runIngest({ mode: 'daily' }, seeded.deps); // NOW is the evening before round 1
  seeded.state.fetched.length = 0;
  const s = await runIngest({ mode: 'gameday' }, seeded.deps);
  assert.equal(s.planned, 1);
  assert.deepEqual(seeded.state.fetched, [['2027 AFL season']]);
  // a quiet day: nothing within 36 hours, so nothing is fetched
  const quiet = { ...seeded.deps, now: () => Date.parse('2027-09-01T00:00:00Z') };
  seeded.state.fetched.length = 0;
  const q = await runIngest({ mode: 'gameday' }, quiet);
  assert.deepEqual([q.planned, q.done, q.pagesFetched, seeded.state.fetched.length], [0, true, 0, 0]);
});

test('gameday: TBC games count by date and pull in both clubs’ pages', async () => {
  const leagues = [{ id: 'nfl', season: '2026' }];
  const teams = ['Kansas City Chiefs', 'Denver Broncos', 'Miami Dolphins'].map((n, i) => ({ id: `N${i}`, league_id: 'nfl', name: n, short_name: null, wiki_page: n }));
  const games = [{ id: 'g1', league_id: 'nfl', home_team_id: 'N0', away_team_id: 'N1', game_date: '2026-09-14', kickoff_at: null, time_tbc: true, status: 'scheduled', venue: 'x', broadcast: null, source_page: '2026 Kansas City Chiefs season', source_rev: 1 }];
  const fx = fakeDb({ leagues, teams, games });
  const fetched = [];
  const deps = { db: fx.db, now: () => Date.parse('2026-09-13T12:00:00Z'), fetchPages: async (t) => { fetched.push(t); return new Map(t.map((x) => [x, null])); } };
  const s = await runIngest({ mode: 'gameday' }, deps);
  assert.deepEqual(fetched.flat().sort(), ['2026 Denver Broncos season', '2026 Kansas City Chiefs season']);
  assert.equal(s.pagesMissing.length, 2);
});

test('daily: time budget stops the run and returns a cursor that resumes it', async () => {
  const leagues = [{ id: 'nfl', season: '2026' }];
  const teams = Array.from({ length: 25 }, (_, i) => ({ id: `N${i}`, league_id: 'nfl', name: `Team ${String(i).padStart(2, '0')}`, short_name: null, wiki_page: `Team ${String(i).padStart(2, '0')}` }));
  const fx = fakeDb({ leagues, teams });
  const fetched = [];
  const deps = { db: fx.db, now: () => 0, fetchPages: async (t) => { fetched.push(t.length); return new Map(t.map((x) => [x, null])); } };
  const a = await runIngest({ mode: 'daily' }, deps, -1);
  assert.deepEqual([a.planned, a.cursor, a.nextCursor, a.done], [25, 0, 10, false]);
  const b = await runIngest({ mode: 'daily', cursor: a.nextCursor }, deps, -1);
  assert.deepEqual([b.cursor, b.nextCursor], [10, 20]);
  const c = await runIngest({ mode: 'daily', cursor: b.nextCursor }, deps, -1);
  assert.deepEqual([c.nextCursor, c.done], [null, true]);
  assert.deepEqual(fetched, [10, 10, 5]);
  const all = await runIngest({ mode: 'daily' }, deps); // normal budget: one call does everything
  assert.deepEqual([all.done, all.pagesMissing.length], [true, 25]);
  const only = await runIngest({ mode: 'daily', league: 'afl' }, deps);
  assert.equal(only.planned, 0);
});

test('team matching: page link first, then name, diacritics and FC suffixes ignored, same league preferred', () => {
  const { indexTeams, resolveTeam, teamKey } = ing;
  assert.equal(teamKey('Arsenal F.C.'), teamKey('Arsenal'));
  assert.equal(teamKey('Atlético Madrid'), 'atletico madrid');
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

test('worklist: page titles follow Wikipedia naming (en dash seasons, "season" and "team" suffixes)', () => {
  const leagues = [
    { id: 'epl', season: '2026-27' }, { id: 'ncaaf', season: '2026' }, { id: 'ncaab', season: '2026-27' }, { id: 'ucl', season: '2026-27' },
  ];
  const mk = (id, league_id, wiki_page) => ({ id, league_id, name: wiki_page, short_name: null, wiki_page });
  const teams = [mk('a', 'epl', 'Arsenal F.C.'), mk('b', 'ncaaf', 'Alabama Crimson Tide football'), mk('c', 'ncaab', "Duke Blue Devils men's basketball")];
  assert.deepEqual(buildWorklist(leagues, teams).map((x) => x.title), [
    '2026\u201327 Arsenal F.C. season',
    '2026\u201327 UEFA Champions League league phase',
    '2026 Alabama Crimson Tide football team',
    "2026\u201327 Duke Blue Devils men's basketball team",
  ]);
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

test('fetcher: gives up after repeated maxlag or server errors', async () => {
  const lag = async () => new Response(JSON.stringify({ error: { code: 'maxlag' } }), { status: 200, headers: { 'Retry-After': '1' } });
  await assert.rejects(createFetcher({ fetchImpl: lag, sleep: async () => {}, maxRetries: 2 })(['x']), /maxlag/);
  const down = async () => new Response('', { status: 503 });
  await assert.rejects(createFetcher({ fetchImpl: down, sleep: async () => {}, maxRetries: 1 })(['x']), /503/);
});

// ---- Edge Function handler (Deno stubbed) ----
test('handler: method, configuration and shared-secret checks', async () => {
  let handler;
  const env = { INGEST_SECRET: 'test-secret-not-real', SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-key-not-real' };
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  const realFetch = globalThis.fetch;
  const rest = [];
  globalThis.fetch = async (url, init) => { rest.push({ url: String(url), headers: init?.headers }); return new Response('[]', { status: 200 }); };
  try {
    await import(new URL('../supabase/functions/ingest-wikipedia/index.ts', import.meta.url).href);
    const call = (method, headers, body) => handler(new Request('https://f.test/', { method, headers, body }));
    assert.equal((await call('GET', {})).status, 405);
    assert.equal((await call('POST', {})).status, 401);
    assert.equal((await call('POST', { 'x-ingest-secret': 'wrong' })).status, 401);
    assert.equal((await call('POST', { 'x-ingest-secret': 'test-secret-not-real-extra' })).status, 401);
    assert.equal(rest.length, 0, 'no database call before authorization');
    assert.equal((await call('POST', { 'x-ingest-secret': env.INGEST_SECRET }, '{"mode":"hourly"}')).status, 400);
    const ok = await call('POST', { 'x-ingest-secret': env.INGEST_SECRET }, '{"mode":"gameday"}');
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.deepEqual([body.mode, body.done, body.planned], ['gameday', true, 0]);
    assert.ok(rest.some((r) => r.url.startsWith('https://example.test/rest/v1/leagues')), 'the call reaches the database (keeps the project awake)');
    delete env.INGEST_SECRET;
    assert.equal((await call('POST', { 'x-ingest-secret': '' })).status, 500, 'fails closed without INGEST_SECRET');
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.Deno;
  }
});
