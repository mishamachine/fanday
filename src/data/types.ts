// Shapes mirror supabase/migrations/0001_init.sql (leagues, teams, games). Keep in step with it.
export type LeagueSource = 'wikipedia' | 'official_link'
export type GameStatus = 'scheduled' | 'postponed' | 'cancelled' | 'final'
export type LinkSlot = 'watch' | 'tickets' | 'sponsor'

export interface League {
  id: string
  name: string
  country: string // display name for the search chip, e.g. "England"
  countryCode: string // ISO-3166 alpha-2; drives 12h/24h
  sport: string
  source: LeagueSource
  inSeason: boolean
}

export interface Team {
  id: string
  leagueId: string
  name: string
  shortName: string // neutral text badge, e.g. "KC". No logos anywhere.
  officialCalendarUrl: string | null
}

export interface Game {
  id: string
  leagueId: string
  sport: string
  homeTeamId: string
  awayTeamId: string
  homeName: string
  awayName: string
  kickoffAt: string | null // ISO instant; null while the time is not published
  gameDate: string // YYYY-MM-DD, always set
  timeTbc: boolean
  status: GameStatus
  venue: string | null
  broadcast: string | null
  countryCode: string
  /** Set when the kickoff changed after we first stored it (from game_changes). */
  previousKickoffAt: string | null
  watchUrl: string | null
  ticketsUrl: string | null
  sponsorText: string | null
  sponsorUrl: string | null
}

export interface DataSource {
  listLeagues(): Promise<League[]>
  listTeams(leagueId: string): Promise<Team[]>
  /**
   * Games for the followed teams from yesterday on, soonest first. With `aheadDays`, only games up to that many days
   * after `now` (the calendar sync asks for 180); without it the list is open-ended and capped at 200.
   */
  listGames(teamIds: string[], now?: Date, aheadDays?: number): Promise<Game[]>
}
