import type { DataSource } from './types.ts'
import { compareGames } from './compare.ts'
import { supabase } from '../lib/supabase.ts'
import { toGame, toLeague, toTeam, type GameRow, type LeagueRow, type TeamRow } from './rows.ts'

function db() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

export const supabaseSource: DataSource = {
  async listLeagues() {
    const { data, error } = await db().from('leagues').select('*').order('sort')
    if (error) throw error
    return (data as LeagueRow[]).map(toLeague)
  },
  async listTeams(leagueId) {
    const { data, error } = await db().from('teams').select('*').eq('league_id', leagueId).order('name')
    if (error) throw error
    return (data as TeamRow[]).map(toTeam)
  },
  async listGames(teamIds, now = new Date()) {
    if (!teamIds.length) return []
    const list = teamIds.map((t) => `"${t}"`).join(',')
    const { data, error } = await db().from('games')
      .select('*, home:teams!games_home_team_id_fkey(name), away:teams!games_away_team_id_fkey(name), league:leagues(sport,country_code), changes:game_changes(field,old_value,detected_at)')
      .or(`home_team_id.in.(${list}),away_team_id.in.(${list})`)
      .gte('game_date', new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10))
      .neq('status', 'cancelled').order('game_date').limit(200)
    if (error) throw error
    return (data as unknown as GameRow[]).map(toGame).sort(compareGames)
  },
}
