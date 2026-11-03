import type { Game, GameStatus, League, Team } from './types.ts'

// Row shapes copy supabase/migrations/0001_init.sql column names exactly.
export interface LeagueRow { id: string; name: string; country: string; country_code: string; sport: string; source: 'wikipedia' | 'official_link'; in_season: boolean }
export interface TeamRow { id: string; league_id: string; name: string; short_name: string; official_calendar_url: string | null }
export interface GameRow {
  id: string; league_id: string; home_team_id: string; away_team_id: string; game_date: string; kickoff_at: string | null
  time_tbc: boolean; status: GameStatus; venue: string | null; broadcast: string | null; country: string | null
  watch_url: string | null; tickets_url: string | null; sponsor_text: string | null; sponsor_url: string | null
  home: { name: string }; away: { name: string }; league: { sport: string; country_code: string }
  changes?: Array<{ field: string; old_value: string | null; detected_at: string }>
}

export const toLeague = (r: LeagueRow): League =>
  ({ id: r.id, name: r.name, country: r.country, countryCode: r.country_code, sport: r.sport, source: r.source, inSeason: r.in_season })

export const toTeam = (r: TeamRow): Team =>
  ({ id: r.id, leagueId: r.league_id, name: r.name, shortName: r.short_name, officialCalendarUrl: r.official_calendar_url })

export function toGame(r: GameRow): Game {
  // Latest kickoff change, if any, becomes the "Moved" state (old value = the time it used to have).
  const moved = (r.changes ?? []).filter((c) => c.field === 'kickoff_at').sort((a, b) => (a.detected_at < b.detected_at ? 1 : -1))[0]
  return {
    id: r.id, leagueId: r.league_id, sport: r.league.sport, homeTeamId: r.home_team_id, awayTeamId: r.away_team_id,
    homeName: r.home.name, awayName: r.away.name, kickoffAt: r.kickoff_at, gameDate: r.game_date, timeTbc: r.time_tbc,
    status: r.status, venue: r.venue, broadcast: r.broadcast, countryCode: r.country ?? r.league.country_code,
    previousKickoffAt: moved?.old_value ?? null, watchUrl: r.watch_url, ticketsUrl: r.tickets_url,
    sponsorText: r.sponsor_text, sponsorUrl: r.sponsor_url,
  }
}

