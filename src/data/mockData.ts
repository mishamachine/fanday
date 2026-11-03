import type { Game, Team } from './types.ts'
import { LEAGUES } from './leagues.ts'

// MOCK DATA. Placeholder teams so every league can be explored before the ingest fills the `teams` table.
// Names are plain text; badges are neutral abbreviations. No logos, no league or team imagery.
const T: Record<string, Array<[string, string]>> = {
  epl: [['ARS', 'Arsenal'], ['CHE', 'Chelsea'], ['LIV', 'Liverpool'], ['MCI', 'Manchester City'], ['MUN', 'Manchester United'], ['TOT', 'Tottenham']],
  nfl: [['KC', 'Chiefs'], ['DEN', 'Broncos'], ['LV', 'Raiders'], ['SF', '49ers'], ['DAL', 'Cowboys'], ['PHI', 'Eagles']],
  nba: [['LAL', 'Lakers'], ['BOS', 'Celtics'], ['GSW', 'Warriors'], ['NYK', 'Knicks']],
  wnba: [['SEA', 'Storm'], ['LVA', 'Aces'], ['NYL', 'Liberty']],
  mlb: [['LAD', 'Dodgers'], ['NYY', 'Yankees'], ['BOS', 'Red Sox']],
  nhl: [['BOS', 'Bruins'], ['TOR', 'Maple Leafs'], ['EDM', 'Oilers'], ['NYR', 'Rangers']],
  mls: [['MIA', 'Inter Miami'], ['LAFC', 'LAFC'], ['SEA', 'Sounders']],
  ncaaf: [['ALA', 'Alabama'], ['OSU', 'Ohio State'], ['MICH', 'Michigan']],
  ncaab: [['DUKE', 'Duke'], ['UNC', 'North Carolina'], ['KU', 'Kansas']],
  laliga: [['BAR', 'Barcelona'], ['RMA', 'Real Madrid'], ['ATM', 'Atletico Madrid']],
  seriea: [['JUV', 'Juventus'], ['INT', 'Inter'], ['MIL', 'Milan']],
  bundesliga: [['BAY', 'Bayern Munich'], ['BVB', 'Dortmund'], ['LEV', 'Leverkusen']],
  ligue1: [['PSG', 'Paris Saint-Germain'], ['OM', 'Marseille'], ['LYO', 'Lyon']],
  ucl: [['RMA', 'Real Madrid'], ['BAY', 'Bayern Munich'], ['ARS', 'Arsenal']],
  ligamx: [['AME', 'America'], ['CHI', 'Guadalajara'], ['TIG', 'Tigres']],
  brasileirao: [['FLA', 'Flamengo'], ['PAL', 'Palmeiras'], ['COR', 'Corinthians']],
  ipl: [['MI', 'Mumbai'], ['CSK', 'Chennai'], ['RCB', 'Bengaluru']],
  afl: [['COL', 'Collingwood'], ['GEE', 'Geelong'], ['SYD', 'Sydney']],
  nrl: [['PEN', 'Panthers'], ['BRO', 'Broncos'], ['STO', 'Storm']],
}

export const MOCK_TEAMS: Team[] = LEAGUES.flatMap((l) =>
  (T[l.id] ?? []).map(([short, name]) => ({
    id: `${l.id}-${short.toLowerCase()}`,
    leagueId: l.id,
    name,
    shortName: short,
    officialCalendarUrl: l.source === 'official_link' ? `https://example.invalid/${l.id}/${short.toLowerCase()}.ics` : null,
  })))

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
    g({ id: 'mock-1', leagueId: 'nfl', sport: 'american_football', homeTeamId: 'nfl-kc', awayTeamId: 'nfl-den', homeName: 'Chiefs', awayName: 'Broncos',
      countryCode: 'US', at: t0 + 3 * DAY + 20.25 * 3_600_000, previousKickoffAt: iso(t0 + 3 * DAY + 19.33 * 3_600_000),
      venue: 'Arrowhead Stadium', broadcast: 'CBS', watchUrl: 'https://example.invalid/watch', ticketsUrl: 'https://example.invalid/tickets' }),
    g({ id: 'mock-2', leagueId: 'epl', sport: 'soccer', homeTeamId: 'epl-ars', awayTeamId: 'epl-che', homeName: 'Arsenal', awayName: 'Chelsea',
      countryCode: 'GB', at: t0 + 5 * DAY + 12.5 * 3_600_000, venue: 'Emirates Stadium', broadcast: 'Sky Sports' }),
    g({ id: 'mock-3', leagueId: 'ipl', sport: 'cricket', homeTeamId: 'ipl-mi', awayTeamId: 'ipl-csk', homeName: 'Mumbai', awayName: 'Chennai',
      countryCode: 'IN', at: t0 + 7 * DAY, kickoffAt: null, timeTbc: true }),
  ]
}
