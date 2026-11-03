import type { Game, Team } from './types.ts'
import { LEAGUES } from './leagues.ts'

import { SEED_TEAMS } from './teams.ts'

// Teams: the real seed (src/data/teams.ts) wherever it has any. PLACEHOLDER teams below only fill leagues the seed does
// not cover yet (WNBA, MLB, Liga MX, Brasileirao, IPL, NRL); they do not exist in the database. Names are plain text and
// badges are neutral abbreviations: no logos, no league or team imagery.
const PLACEHOLDER: Record<string, Array<[string, string]>> = {
  wnba: [['SEA', 'Storm'], ['LVA', 'Aces'], ['NYL', 'Liberty']],
  mlb: [['LAD', 'Dodgers'], ['NYY', 'Yankees'], ['BOS', 'Red Sox']],
  ligamx: [['AME', 'America'], ['CHI', 'Guadalajara'], ['TIG', 'Tigres']],
  brasileirao: [['FLA', 'Flamengo'], ['PAL', 'Palmeiras'], ['COR', 'Corinthians']],
  ipl: [['MI', 'Mumbai'], ['CSK', 'Chennai'], ['RCB', 'Bengaluru']],
  nrl: [['PEN', 'Panthers'], ['BRO', 'Broncos'], ['STO', 'Storm']],
}
const seeded = new Set(SEED_TEAMS.map((t) => t.leagueId))

export const MOCK_TEAMS: Team[] = [
  ...SEED_TEAMS,
  ...LEAGUES.filter((l) => !seeded.has(l.id)).flatMap((l) => (PLACEHOLDER[l.id] ?? []).map(([short, name]) => ({
    id: `${l.id}-${short.toLowerCase()}`, leagueId: l.id, name, shortName: short, officialCalendarUrl: null,
  }))),
]

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()
const ymd = (ms: number) => iso(ms).slice(0, 10)

/** Mock games, built relative to `now` so the list is never empty. Mirrors the design file's screen 3. */
export function mockGames(now: Date = new Date()): Game[] {
  const t0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const g = (o: Partial<Game> & Pick<Game, 'id' | 'leagueId' | 'sport' | 'homeTeamId' | 'awayTeamId' | 'homeName' | 'awayName' | 'countryCode'> & { at: number }): Game => ({
    kickoffAt: iso(o.at), gameDate: ymd(o.at), timeTbc: false, status: 'scheduled', venue: null, broadcast: null,
    previousKickoffAt: null, watchUrl: null, ticketsUrl: null, sponsorText: null, sponsorUrl: null, ...o,
  })
  return [
    g({ id: 'mock-1', leagueId: 'nfl', sport: 'american_football', homeTeamId: 'nfl-kansas-city-chiefs', awayTeamId: 'nfl-denver-broncos', homeName: 'Chiefs', awayName: 'Broncos',
      countryCode: 'US', at: t0 + 3 * DAY + 20.25 * 3_600_000, previousKickoffAt: iso(t0 + 3 * DAY + 19.33 * 3_600_000),
      venue: 'Arrowhead Stadium', broadcast: 'CBS', watchUrl: 'https://example.invalid/watch', ticketsUrl: 'https://example.invalid/tickets' }),
    g({ id: 'mock-2', leagueId: 'epl', sport: 'soccer', homeTeamId: 'epl-arsenal', awayTeamId: 'epl-chelsea', homeName: 'Arsenal', awayName: 'Chelsea',
      countryCode: 'GB', at: t0 + 5 * DAY + 12.5 * 3_600_000, venue: 'Emirates Stadium', broadcast: 'Sky Sports' }),
    g({ id: 'mock-3', leagueId: 'ipl', sport: 'cricket', homeTeamId: 'ipl-mi', awayTeamId: 'ipl-csk', homeName: 'Mumbai', awayName: 'Chennai',
      countryCode: 'IN', at: t0 + 7 * DAY, kickoffAt: null, timeTbc: true }),
  ]
}
