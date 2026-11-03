// Parser tests against real Wikipedia wikitext saved on 2026-11-02 (see scripts/test-ingest-fixtures/).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, load, REVID } from './test-ingest-lib.mjs';

const { parseWikitext } = await load('parse.ts');
const { parseTime, parseDate, localToUtc, resolveZone, toKickoff } = await load('time.ts');
const { findTemplates, cleanText, splitTopLevel } = await load('wikitext.ts');

const parse = (kind, name, ctx) => parseWikitext(kind, fixture(name), ctx);
const inSection = (games, section) => games.filter((g) => g.section === section);
const find = (games, date, home, away) => games.find((g) => g.date === date && g.home.name === home && (!away || g.away.name === away));
const tally = (games) => ({ total: games.length, timed: games.filter((g) => !g.timeTbc).length, tbc: games.filter((g) => g.timeTbc).length });

test('fixtures carry Wikipedia credit and the revision id', () => {
  for (const [name, rev] of Object.entries(REVID)) {
    const head = fixture(name).slice(0, 700);
    assert.match(head, /^<!-- FIXTURE/);
    assert.ok(head.includes(`Revision id: ${rev}`), `${name} revision id`);
    assert.match(head, /CC BY-SA 4\.0/);
  }
});

test('football: Arsenal 2026-27, Premier League (UK time, BST/GMT labels, TBC)', () => {
  const pl = inSection(parse('football', 'arsenal', { tz: 'Europe/London' }), 'Premier League');
  assert.deepEqual(tally(pl), { total: 38, timed: 21, tbc: 17 });
  // 20:00 BST on 21 Aug is 19:00Z
  const opener = find(pl, '2026-08-21', 'Arsenal', 'Coventry City');
  assert.equal(opener.kickoffAt, '2026-08-21T19:00:00Z');
  assert.equal(opener.venue, 'Emirates Stadium');
  assert.deepEqual(opener.away, { name: 'Coventry City', page: 'Coventry City F.C.' });
  assert.equal(opener.broadcast, null);
  // "TBC GMT" -> date only
  const tbc = find(pl, '2027-01-16', 'Hull City', 'Arsenal');
  assert.equal(tbc.timeTbc, true);
  assert.equal(tbc.kickoffAt, null);
  assert.equal(tbc.venue, 'MKM Stadium');
  assert.equal(tbc.status, 'scheduled');
  // other competitions on the page keep their own section, so the ingest can drop them
  assert.ok(inSection(parse('football', 'arsenal', { tz: 'Europe/London' }), 'UEFA Champions League').length > 0);
});

test('time zones: UK clocks go back on 25 Oct 2026 (BST label before, GMT label after)', () => {
  const pl = inSection(parse('football', 'arsenal', { tz: 'Europe/London' }), 'Premier League');
  assert.equal(find(pl, '2026-10-24', 'Arsenal', 'Everton').kickoffAt, '2026-10-24T14:00:00Z'); // 15:00 BST
  assert.equal(find(pl, '2026-11-01', 'Liverpool', 'Arsenal').kickoffAt, '2026-11-01T16:30:00Z'); // 16:30 GMT
});

test('time zones: DST boundary with no label uses the league zone (UCL is CET/CEST)', () => {
  const ucl = parse('football', 'ucl', { tz: 'Europe/Paris' });
  assert.equal(find(ucl, '2026-10-21', 'Bayern Munich', 'Arsenal').kickoffAt, '2026-10-21T19:00:00Z'); // 21:00 CEST
  assert.equal(find(ucl, '2026-11-04', 'Slavia Prague', 'Arsenal').kickoffAt, '2026-11-04T20:00:00Z'); // 21:00 CET, after 25 Oct
  assert.equal(find(ucl, '2026-09-08', 'AEK Athens', 'LASK').kickoffAt, '2026-09-08T16:45:00Z'); // 18:45 CEST; small (19:45 UTC+3) ignored
});

test('football: UCL league phase 2026-27 (#invoke:Football box)', () => {
  const ucl = parse('football', 'ucl', { tz: 'Europe/Paris' });
  assert.deepEqual(tally(ucl), { total: 144, timed: 144, tbc: 0 }); // 36 teams x 8 / 2
  assert.equal(ucl.filter((g) => g.status === 'final').length, 54);
  assert.equal(ucl.filter((g) => g.status === 'scheduled').length, 90); // matches wikipedia-coverage.md
  const g = find(ucl, '2026-09-08', 'AEK Athens', 'LASK');
  assert.equal(g.status, 'final');
  assert.equal(g.venue, 'Agia Sophia Stadium, Athens');
  assert.deepEqual(g.home, { name: 'AEK Athens', page: 'AEK Athens F.C.' });
});

test('football: La Liga, Serie A, Bundesliga, Ligue 1, MLS counts', () => {
  assert.deepEqual(tally(inSection(parse('football', 'barca', { tz: 'Europe/Madrid' }), 'La Liga')), { total: 38, timed: 13, tbc: 25 });
  assert.deepEqual(tally(inSection(parse('football', 'juve', { tz: 'Europe/Rome' }), 'Serie A')), { total: 38, timed: 19, tbc: 19 });
  assert.deepEqual(tally(inSection(parse('football', 'psg', { tz: 'Europe/Paris' }), 'Ligue 1')), { total: 34, timed: 23, tbc: 11 });
  // Bundesliga: 22 of 34 rows only name a weekend window ("4-6 December 2026"); those have no single date and are skipped
  assert.deepEqual(tally(inSection(parse('football', 'bayern', { tz: 'Europe/Berlin' }), 'Bundesliga')), { total: 12, timed: 12, tbc: 0 });
  const mls = inSection(parse('football', 'miami', { tz: 'America/New_York', year: 2026 }), 'Major League Soccer (MLS)');
  assert.deepEqual(tally(mls), { total: 34, timed: 34, tbc: 0 });
});

test('football: "--:--" with a CET label is TBC (Barcelona)', () => {
  const liga = inSection(parse('football', 'barca', { tz: 'Europe/Madrid' }), 'La Liga');
  const tbc = liga.filter((g) => g.timeTbc);
  assert.equal(tbc.length, 25);
  assert.ok(tbc.every((g) => g.kickoffAt === null && /^\d{4}-\d{2}-\d{2}$/.test(g.date)));
});

test('football: MLS dates with no year take the season year', () => {
  const mls = inSection(parse('football', 'miami', { tz: 'America/New_York', year: 2026 }), 'Major League Soccer (MLS)');
  assert.ok(mls.every((g) => g.date.startsWith('2026-')));
  assert.ok(mls.every((g) => g.kickoffAt && g.kickoffAt.startsWith('2026-')));
});

test('AFL 2027: 135 of 207 rows have a date; local times convert per venue', () => {
  const afl = parse('afl', 'afl', { year: 2027 });
  assert.equal(findTemplates(fixture('afl'), ['aflgame']).length, 207);
  assert.deepEqual(tally(afl), { total: 135, timed: 135, tbc: 0 });
  // Round 1 opener: Wed 17 March 7:30pm at the SCG, AEDT (UTC+11) -> 08:30Z
  const opener = find(afl, '2027-03-17', 'Sydney Swans', 'Geelong Cats');
  assert.equal(opener.kickoffAt, '2027-03-17T08:30:00Z');
  assert.equal(opener.venue, 'Sydney Cricket Ground');
  assert.equal(opener.section, 'Round 1');
  assert.deepEqual(opener.home, { name: 'Sydney Swans', page: 'Sydney Swans' });
  // Perth has no DST: Thu 18 March 5:10pm AWST (UTC+8) -> 09:10Z
  assert.equal(find(afl, '2027-03-18', 'Fremantle', 'Western Bulldogs').kickoffAt, '2027-03-18T09:10:00Z');
});

test('time zones: AFL DST ends 4 Apr 2027 (AEDT -> AEST)', () => {
  const afl = parse('afl', 'afl', { year: 2027 });
  assert.equal(find(afl, '2027-04-03', 'St Kilda', 'Melbourne').kickoffAt, '2027-04-03T02:35:00Z'); // 1:35pm AEDT
  assert.equal(find(afl, '2027-04-04', 'Geelong Cats', 'Richmond').kickoffAt, '2027-04-04T02:30:00Z'); // 12:30pm AEST
  // Adelaide is 30 minutes behind Melbourne: 4:05pm ACDT on 3 April
  assert.equal(find(afl, '2027-04-03', 'Adelaide Crows', 'Western Bulldogs').kickoffAt, '2027-04-03T05:35:00Z');
  // Queensland has no DST: Sun 4 April 3:15pm AEST
  assert.equal(find(afl, '2027-04-04', 'Gold Coast Suns', 'North Melbourne').kickoffAt, '2027-04-04T05:15:00Z');
});

test('NFL: Chiefs 2026 wikitable (CT header, TV column, bye, TBD times)', () => {
  const ctx = { year: 2026, subject: { name: 'Kansas City Chiefs', page: null } };
  const all = parse('nfl', 'chiefs', ctx);
  const reg = inSection(all, 'Schedule');
  assert.equal(all.length, 20); // 3 preseason + 17 regular season; the week-5 bye is not a game
  assert.deepEqual(tally(reg), { total: 17, timed: 15, tbc: 2 });
  assert.equal(inSection(all, 'Preseason').length, 3);
  const w1 = find(reg, '2026-09-14', 'Kansas City Chiefs');
  assert.equal(w1.away.name, 'Denver Broncos');
  assert.equal(w1.kickoffAt, '2026-09-15T00:15:00Z'); // 7:15pm CDT
  assert.equal(w1.venue, 'Arrowhead Stadium');
  assert.equal(w1.broadcast, 'ESPN/ABC');
  // away game: "at Miami Dolphins"
  const w3 = find(reg, '2026-09-27', 'Miami Dolphins');
  assert.equal(w3.away.name, 'Kansas City Chiefs');
  assert.equal(w3.kickoffAt, '2026-09-27T17:00:00Z'); // 12:00 CDT
  // Weeks 17-18: "TBD" times, "January 9/10" date -> first day, year rolls over
  const w18 = reg.at(-1);
  assert.deepEqual([w18.date, w18.timeTbc, w18.kickoffAt], ['2027-01-09', true, null]);
  assert.equal(w18.broadcast, null);
  assert.equal(reg.some((g) => g.home.name.includes('Bye') || g.away.name.includes('Bye')), false);
});

test('time zones: US DST ends 1 Nov 2026 (Chiefs, CT column)', () => {
  const reg = inSection(parse('nfl', 'chiefs', { year: 2026, subject: { name: 'Kansas City Chiefs', page: null } }), 'Schedule');
  assert.equal(find(reg, '2026-10-25', 'Seattle Seahawks').kickoffAt, '2026-10-26T00:20:00Z'); // 7:20pm CDT (UTC-5)
  assert.equal(find(reg, '2026-11-01', 'Denver Broncos').kickoffAt, '2026-11-01T21:25:00Z'); // 3:25pm CST (UTC-6)
});

test('CFB: Alabama 2026 (timezone = Central, TV, away flag, blank time = TBC)', () => {
  const g = parse('cfb', 'alabama', { year: 2026, subject: { name: 'Alabama', page: null } });
  assert.deepEqual(tally(g), { total: 12, timed: 10, tbc: 2 });
  const opener = find(g, '2026-09-05', 'Alabama', 'East Carolina');
  assert.equal(opener.kickoffAt, '2026-09-05T16:00:00Z'); // 11:00 a.m. CDT
  assert.equal(opener.venue, 'Bryant–Denny Stadium');
  assert.equal(opener.broadcast, 'ABC');
  const away = find(g, '2026-09-12', 'Kentucky', 'Alabama'); // away = y
  assert.equal(away.venue, 'Kroger Field');
  assert.equal(away.kickoffAt, '2026-09-12T19:30:00Z');
  const iron = find(g, '2026-11-28', 'Alabama', 'Auburn');
  assert.deepEqual([iron.timeTbc, iron.kickoffAt, iron.broadcast], [true, null, null]);
  // Central time moves back on 1 Nov: 2:30 p.m. on 7 Nov is CST
  assert.equal(find(g, '2026-11-07', 'LSU', 'Alabama').kickoffAt, '2026-11-07T20:30:00Z');
});

test('CBB: Duke 2026-27 (Eastern, full dates, exhibition games keep their section)', () => {
  const g = parse('cbb', 'duke', { subject: { name: 'Duke', page: null } });
  assert.equal(g.length, 35);
  assert.equal(g.filter((x) => x.section === 'Exhibition').length, 3);
  const reg = g.filter((x) => x.section === 'Regular season');
  assert.deepEqual(tally(reg), { total: 32, timed: 32, tbc: 0 });
  const first = find(reg, '2026-11-02', 'Duke');
  assert.equal(first.kickoffAt, '2026-11-02T23:30:00Z'); // 6:30 p.m. EST (UTC-5) after DST ended
  const oct = find(g, '2026-10-20', 'Duke', 'Tennessee');
  assert.equal(oct.kickoffAt, '2026-10-20T23:00:00Z'); // 7:00 p.m. EDT (UTC-4)
  assert.equal(oct.broadcast, 'ACCN');
  assert.equal(find(g, '2027-03-06', 'North Carolina', 'Duke').venue, 'Dean Smith Center');
});

test('Liga MX: Club America 2026-27 (CST/PDT labels, Apertura section, bad minute is TBC)', () => {
  const g = parse('football', 'america', { tz: 'America/Mexico_City' });
  const ap = g.filter((x) => /^Apertura/.test(x.section));
  assert.equal(ap.length, 17);
  assert.equal(g.length, 28);
  assert.ok(ap.every((x) => x.kickoffAt || x.timeTbc));
  assert.ok(g.some((x) => x.timeTbc), '"21:90" is not a time');
  const first = g.find((x) => x.date === '2026-06-28');
  assert.equal(first.home.name, 'Trival Valderas');
  assert.equal(first.away.name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''), 'America');
});

test('Liga MX context: CT/CST/CDT labels map to America/Mexico_City (no DST), other labels keep their zone', () => {
  const box = (time) => `{{Football box|date=3 July 2026|time=${time}|team1=A|team2=B|score=}}`;
  const alias = { CT: 'America/Mexico_City', CST: 'America/Mexico_City', CDT: 'America/Mexico_City' };
  const at = (t, ctx) => parseWikitext('football', box(t), ctx)[0].kickoffAt;
  assert.equal(at('20:00 [[Central Time Zone|CDT]]', { zoneAliases: alias }), '2026-07-04T02:00:00Z'); // Mexico City is UTC-6 all year
  assert.equal(at('20:00 [[Central Time Zone|CDT]]', {}), '2026-07-04T01:00:00Z'); // elsewhere CDT stays UTC-5
  assert.equal(at('20:00 CT', { zoneAliases: alias }), '2026-07-04T02:00:00Z');
  assert.equal(at('20:00 [[Pacific Time Zone|PDT]]', { zoneAliases: alias }), '2026-07-04T03:00:00Z');
  const g = parse('football', 'america', { tz: 'America/Mexico_City', zoneAliases: alias });
  assert.equal(find(g, '2026-06-28', 'Trival Valderas').kickoffAt, '2026-06-28T12:00:00Z');
});

test('Brasileirao: Flamengo 2026 ({{UTZ|21:30|-3}} times, Campeonato Brasileiro section)', () => {
  const g = parse('football', 'flamengo', { tz: 'America/Sao_Paulo' });
  const br = g.filter((x) => /^Campeonato Brasileiro/.test(x.section));
  assert.equal(br.length, 37);
  assert.equal(g.length, 68);
  // 3 July 2026, {{UTZ|15:30|-3}} -> 18:30Z (listed second line of the first friendly)
  assert.equal(find(g, '2026-07-03', 'Flamengo', 'River Plate').kickoffAt, '2026-07-03T18:30:00Z');
  assert.deepEqual(parseTime('{{UTZ|21:30|-3}}'), { kind: 'time', h: 21, mi: 30, zoneLabel: 'UTC-3' });
});

test('MLB: Dodgers game log, 2026 results and the 2027 placeholder log (dates only, @ = away)', () => {
  const ctx = (year) => ({ year, subject: { name: 'Los Angeles Dodgers', page: 'Los Angeles Dodgers' } });
  const a = parse('gamelog', 'dodgers', ctx(2026));
  assert.deepEqual(tally(a), { total: 170, timed: 0, tbc: 170 }); // 162 + postseason rows
  const opener = find(a, '2026-03-26', 'Los Angeles Dodgers');
  assert.deepEqual([opener.away.name, opener.away.page, opener.status, opener.venue], ['Arizona Diamondbacks', 'Arizona Diamondbacks', 'final', null]);
  const road = find(a, '2026-04-03', 'Washington Nationals');
  assert.equal(road.away.name, 'Los Angeles Dodgers');
  const b = parse('gamelog', 'dodgers27', ctx(2027));
  assert.deepEqual(tally(b), { total: 162, timed: 0, tbc: 162 });
  assert.equal(b.every((x) => x.status === 'scheduled'), true);
  assert.equal(find(b, '2027-03-25', 'Los Angeles Dodgers').away.name, 'Atlanta Braves');
});

test('WNBA: Seattle Storm game log (Preseason section kept apart)', () => {
  const g = parse('gamelog', 'storm', { year: 2026, subject: { name: 'Seattle Storm', page: 'Seattle Storm' } });
  assert.equal(g.length, 46);
  assert.equal(g.filter((x) => x.section === 'Regular season').length, 44);
  assert.equal(g.filter((x) => x.section === 'Preseason').length, 2);
  const away = find(g, '2026-04-25', 'Golden State Valkyries');
  assert.equal(away.away.name, 'Seattle Storm');
  assert.equal(away.timeTbc, true);
});

test('IPL 2026: Single-innings cricket match, IST times, (H) marks the home side', () => {
  const g = parse('cricket', 'ipl', { year: 2026 });
  assert.equal(g.length, 74);
  assert.equal(g.filter((x) => x.timeTbc).length, 0);
  const m1 = find(g, '2026-03-28', 'Royal Challengers Bengaluru', 'Sunrisers Hyderabad'); // team2 is (H)
  assert.equal(m1.kickoffAt, '2026-03-28T14:00:00Z'); // 19:30 IST
  assert.equal(m1.venue, 'M. Chinnaswamy Stadium, Bengaluru');
  assert.equal(g.at(-1).section, 'Final');
});

test('NRL 2026 results page: date from the round line, venue carried down a rowspan, local time by ground', () => {
  const g = parse('rugby', 'nrlres', { year: 2026 });
  assert.equal(g.length, 204);
  assert.equal(g.filter((x) => x.timeTbc).length, 0);
  // Las Vegas: Sunday 1 March 12:15pm PST -> 20:15Z; second game at the same ground has no venue cell
  const lv1 = find(g, '2026-03-01', 'Newcastle Knights');
  assert.deepEqual([lv1.kickoffAt, lv1.venue], ['2026-03-01T20:15:00Z', 'Allegiant Stadium']);
  const lv2 = find(g, '2026-03-01', 'Canterbury-Bankstown Bulldogs');
  assert.deepEqual([lv2.kickoffAt, lv2.venue], ['2026-03-01T22:30:00Z', 'Allegiant Stadium']);
  // Thursday 5 March 7:00pm AEDT at AAMI Park -> 08:00Z
  assert.equal(find(g, '2026-03-05', 'Melbourne Storm').kickoffAt, '2026-03-05T08:00:00Z');
  // Round 2 gives "Thursday, 7:00 pm" only; Round 2 starts 12 March (a Thursday)
  assert.equal(find(g, '2026-03-12', 'Brisbane Broncos').kickoffAt, '2026-03-12T09:00:00Z'); // Suncorp: AEST, no DST
  // New Zealand ground is NZDT (UTC+13) in March
  assert.equal(find(g, '2026-03-06', 'New Zealand Warriors').kickoffAt, '2026-03-06T04:00:00Z');
});

test('no zone, no guess: an unlabeled time with no known zone is TBC (MLS home-team zone)', () => {
  const src = fixture('miami').replace(/(\|\s*time\s*=[^\n]*?)\s*\[\[[^\]|]*Time Zone\|[A-Z]{2,4}\]\]/g, '$1');
  const base = { year: 2026, zoneFromHome: true };
  const unknown = parseWikitext('football', src, { ...base, homeTz: () => null });
  const mls = inSection(unknown, 'Major League Soccer (MLS)');
  assert.ok(mls.length === 34 && mls.every((g) => g.timeTbc && g.kickoffAt === null), 'no home zone: all TBC');
  const known = parseWikitext('football', src, { ...base, homeTz: (t) => (t.name.includes('Miami') ? 'America/New_York' : 'America/Chicago') });
  const timed = inSection(known, 'Major League Soccer (MLS)').filter((g) => !g.timeTbc);
  assert.ok(timed.length > 20, 'unlabeled times convert with the home team zone');
  const home = timed.find((g) => g.home.name.includes('Miami'));
  assert.equal(new Date(home.kickoffAt).getUTCMinutes() % 5, 0);
  const t = parseWikitext('football', '{{Football box|date=3 July 2026|time=20:00|team1=A|team2=B|score=}}', {});
  assert.deepEqual([t[0].timeTbc, t[0].kickoffAt], [true, null], 'no ctx zone at all is TBC, not UTC');
});

test('time and date unit cases', () => {
  assert.deepEqual(parseTime('--:-- [[Central European Time|CET]] ([[UTC+01:00|UTC+1]])'), { kind: 'tbc' });
  assert.deepEqual(parseTime('TBC [[British Summer Time|BST]]'), { kind: 'tbc' });
  assert.deepEqual(parseTime(''), { kind: 'tbc' });
  assert.deepEqual(parseTime(undefined), { kind: 'tbc' });
  assert.deepEqual(parseTime('{{abbr|TBD|To be determined}}'), { kind: 'tbc' });
  assert.deepEqual(parseTime('7:30&nbsp;p.m. [[Eastern Time Zone|EDT]]'), { kind: 'time', h: 19, mi: 30, zoneLabel: 'EDT' });
  assert.deepEqual(parseTime('12:00{{nbsp}}a.m.'), { kind: 'time', h: 0, mi: 0, zoneLabel: null });
  assert.deepEqual(parseTime('21:00 [[CET]]<br/>(20:00 [[GMT]])'), { kind: 'time', h: 21, mi: 0, zoneLabel: 'CET' });
  assert.deepEqual(parseTime('18:45&nbsp;{{small|(19:45 [[UTC+03:00|UTC+3]])}}'), { kind: 'time', h: 18, mi: 45, zoneLabel: null });
  assert.deepEqual(parseTime('4:00/4:30 p.m.'), { kind: 'time', h: 16, mi: 0, zoneLabel: null });
  assert.deepEqual(parseTime('20:00 [[Time in South Korea|KST]]<br>13:00 [[CEST]]'), { kind: 'time', h: 20, mi: 0, zoneLabel: 'KST' });
  assert.deepEqual(parseDate('{{Start date|2026|7|25|df=y}}'), { y: 2026, m: 7, d: 25 });
  assert.deepEqual(parseDate('16 January 2027'), { y: 2027, m: 1, d: 16 });
  assert.deepEqual(parseDate('{{dow tooltip|September 14, 2026}}'), { y: 2026, m: 9, d: 14 });
  assert.deepEqual(parseDate('Saturday, 27 February (4:40&nbsp;pm)', { year: 2027 }), { y: 2027, m: 2, d: 27 });
  assert.deepEqual(parseDate('January 9/10', { year: 2026, crossYear: true }), { y: 2027, m: 1, d: 9 });
  assert.equal(parseDate('4–6 December 2026'), null);
  assert.equal(parseDate('Dates and times TBC', { year: 2027 }), null);
  assert.equal(parseDate('September 20'), null); // no year anywhere
  assert.equal(parseDate('31 February 2027'), null);
});

test('zones: fixed labels, IANA labels, and the DST edge itself', () => {
  assert.deepEqual(resolveZone('CEST'), { offsetMin: 120 });
  assert.deepEqual(resolveZone('UTC+05:30'), { offsetMin: 330 });
  assert.deepEqual(resolveZone('CT'), { iana: 'America/Chicago' });
  assert.equal(resolveZone('nonsense'), null);
  const london = { iana: 'Europe/London' };
  assert.equal(localToUtc(2026, 10, 25, 0, 30, london), '2026-10-24T23:30:00Z'); // still BST
  assert.equal(localToUtc(2026, 10, 25, 12, 0, london), '2026-10-25T12:00:00Z'); // GMT
  const chicago = { iana: 'America/Chicago' };
  assert.equal(localToUtc(2026, 3, 8, 12, 0, chicago), '2026-03-08T17:00:00Z'); // spring forward day, noon is CDT
  assert.equal(localToUtc(2026, 3, 7, 12, 0, chicago), '2026-03-07T18:00:00Z'); // day before: CST
  assert.deepEqual(toKickoff({ y: 2026, m: 8, d: 1 }, { kind: 'tbc' }, london), { kickoffAt: null, timeTbc: true });
});

test('wikitext helpers', () => {
  assert.deepEqual(splitTopLevel('a|{{x|y}}|[[p|q]]|b', '|'), ['a', '{{x|y}}', '[[p|q]]', 'b']);
  assert.equal(cleanText("[[Foo Bar|Foo]] '''bold''' {{fbaicon|GRE}}&nbsp;x"), 'Foo bold x');
});
