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
  async listGames(teamIds, now = new Date(), aheadDays) {
    if (!teamIds.length) return []
    const list = teamIds.map((t) => `"${t}"`).join(',')
    const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10)
    let q = db().from('games')
      .select('*, home:teams!games_home_team_id_fkey(name), away:teams!games_away_team_id_fkey(name), league:leagues(sport,country_code), changes:game_changes(field,old_value,detected_at)')
      .or(`home_team_id.in.(${list}),away_team_id.in.(${list})`)
      .gte('game_date', day(-1))
      .neq('status', 'cancelled').order('game_date')
    if (aheadDays !== undefined) q = q.lte('game_date', day(aheadDays))
    const { data, error } = await q.limit(aheadDays !== undefined ? 1000 : 200) // 1000 = PostgREST's default row cap
    if (error) throw error
    return (data as unknown as GameRow[]).map(toGame).sort(compareGames)
  },
}
