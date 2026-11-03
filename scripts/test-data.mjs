import { eq, ok, done } from './_t.mjs'
import { LEAGUES } from '../src/data/leagues.ts'
import { MOCK_TEAMS, mockGames } from '../src/data/mockData.ts'
import { compareGames } from '../src/data/compare.ts'
import { toGame, toLeague, toTeam } from '../src/data/rows.ts'
import { readFileSync } from 'node:fs'

// Every league in the README list is present; NBA/NHL are official-link; off-season ones are flagged.
eq('league count', LEAGUES.length, 19)
eq('official-link leagues', LEAGUES.filter((l) => l.source === 'official_link').map((l) => l.id), ['nba', 'nhl'])
eq('off-season leagues', LEAGUES.filter((l) => !l.inSeason).map((l) => l.id).sort(), ['ipl', 'mlb', 'nrl', 'wnba'])
// seed.sql and the TS list agree.
const seed = readFileSync(new URL('../supabase/seed.sql', import.meta.url), 'utf8')
ok('seed.sql has every league id', LEAGUES.every((l) => seed.includes(`('${l.id}',`)))

// No logos: teams carry text only.
ok('team badges are short text', MOCK_TEAMS.every((t) => /^[A-Z0-9]{2,4}$/.test(t.shortName)))
ok('no logo or image fields anywhere', !JSON.stringify([MOCK_TEAMS, LEAGUES, mockGames()]).match(/logo|image|\.png|\.svg/i))
ok('every league has teams', LEAGUES.every((l) => MOCK_TEAMS.some((t) => t.leagueId === l.id)))

// Mock games cover Moved, Time TBC.
const g = mockGames(new Date('2026-11-02T10:00:00Z'))
ok('mock has a moved and a TBC game', g.some((x) => x.previousKickoffAt) && g.some((x) => x.timeTbc && x.kickoffAt === null))
eq('compareGames orders by time, TBC by date', [g[1], g[0]].sort(compareGames).map((x) => x.id), ['mock-1', 'mock-2'])

// Row mapper fixture copies the 0001_init.sql column names and the PostgREST embed shape.
const row = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001', league_id: 'nfl', home_team_id: 'nfl-kc', away_team_id: 'nfl-den', game_date: '2026-11-08',
  kickoff_at: '2026-11-08T20:20:00+00:00', time_tbc: false, status: 'scheduled', venue: 'Arrowhead Stadium', broadcast: 'CBS', country: null,
  watch_url: null, tickets_url: null, sponsor_text: null, sponsor_url: null,
  home: { name: 'Chiefs' }, away: { name: 'Broncos' }, league: { sport: 'american_football', country_code: 'US' },
  changes: [{ field: 'venue', old_value: 'Old', detected_at: '2026-11-03T00:00:00Z' }, { field: 'kickoff_at', old_value: '2026-11-08T19:20:00+00:00', detected_at: '2026-11-04T00:00:00Z' }],
}
const m = toGame(row)
eq('mapper: names, country fallback to league', [m.homeName, m.awayName, m.countryCode, m.sport], ['Chiefs', 'Broncos', 'US', 'american_football'])
eq('mapper: latest kickoff change becomes "moved from"', m.previousKickoffAt, '2026-11-08T19:20:00+00:00')
eq('mapper: venue change alone is not "moved"', toGame({ ...row, changes: [row.changes[0]] }).previousKickoffAt, null)
eq('mapper: game country overrides league', toGame({ ...row, country: 'GB' }).countryCode, 'GB')
eq('league/team mappers', [toLeague({ id: 'nba', name: 'NBA', country: 'USA', country_code: 'US', sport: 'basketball', source: 'official_link', in_season: true }).source,
  toTeam({ id: 'nba-lal', league_id: 'nba', name: 'Lakers', short_name: 'LAL', official_calendar_url: null }).shortName], ['official_link', 'LAL'])
done()
