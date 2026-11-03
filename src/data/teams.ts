import type { Team } from './types.ts'
import raw from '../../supabase/seed/teams.json' with { type: 'json' }

// Real teams from the seed (supabase/seed/teams.json, built from Wikipedia 2026-11-02). Same rows the database gets.
interface SeedTeam { id: string; league_id: string; name: string; short_name: string; wiki_page: string | null; official_calendar_url: string | null }

export const SEED_TEAMS: Team[] = (raw as SeedTeam[]).map((t) => ({
  id: t.id, leagueId: t.league_id, name: t.name, shortName: t.short_name, officialCalendarUrl: t.official_calendar_url,
}))
