import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { eq, ok, done } from './_t.mjs'
import { LEAGUES } from '../src/data/leagues.ts'

const teams = JSON.parse(readFileSync(new URL('../supabase/seed/teams.json', import.meta.url), 'utf8'))
const by = (l) => teams.filter((t) => t.league_id === l)
// Counts checked against each league's own season page on 2026-11-02.
const want = { epl: 20, laliga: 20, seriea: 20, bundesliga: 18, ligue1: 18, mls: 30, nfl: 32, afl: 18, ucl: 36, ncaaf: 25, ncaab: 25, nba: 30, nhl: 32 }
for (const [l, n] of Object.entries(want)) eq(`${l}: ${n} teams`, by(l).length, n)
eq('league ids the ingest uses all exist', ['epl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'ucl', 'mls', 'nfl', 'ncaaf', 'ncaab', 'afl'].every((id) => LEAGUES.some((l) => l.id === id)), true)
ok('every team belongs to a known league', teams.every((t) => LEAGUES.some((l) => l.id === t.league_id)))
eq('team ids unique', new Set(teams.map((t) => t.id)).size, teams.length)
ok('short names unique within a league (ingest matches on them)', Object.keys(want).every((l) => new Set(by(l).map((t) => t.short_name)).size === by(l).length))
ok('short names are neutral text', teams.every((t) => /^[A-Z0-9]{2,4}$/.test(t.short_name)))
ok('NBA/NHL: no wiki_page, official link slot present', [...by('nba'), ...by('nhl')].every((t) => t.wiki_page === null && 'official_calendar_url' in t))
ok('all other teams have a wiki_page', teams.filter((t) => !['nba', 'nhl'].includes(t.league_id)).every((t) => t.wiki_page))
ok('NCAA stems end in "football" / "basketball" (ingest appends " team")', by('ncaaf').every((t) => /football$/.test(t.wiki_page)) && by('ncaab').every((t) => /basketball$/.test(t.wiki_page)))
const ars = (l) => by(l).find((t) => t.name === 'Arsenal')
eq('Arsenal: one row per league, same page', [ars('epl')?.id, ars('ucl')?.id, ars('epl')?.wiki_page === ars('ucl')?.wiki_page], ['epl-arsenal', 'ucl-arsenal', true])
ok('no logo or image fields', !/logo|image|\.png|\.svg/i.test(JSON.stringify(teams)))
try { execFileSync('node', ['scripts/build-teams-seed.mjs', '--check'], { stdio: 'pipe' }); ok('seed_teams.sql matches teams.json', true) } catch { ok('seed_teams.sql matches teams.json', false, 'run node scripts/build-teams-seed.mjs') }
done()
