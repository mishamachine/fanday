import { supabase } from '../lib/supabase.ts'
import { ensureDeviceToken, getDeviceToken } from '../lib/deviceToken.ts'

// Server copy of the followed teams. Signed in: the follows table (RLS keys it to auth.uid()); adding goes through fanday.user_follows_add. Signed out: the device-token RPCs
// (fanday.device_follows_*), which act only on the rows of the device that owns the token. Best effort: the local copy wins offline.

export async function loadRemoteFollows(signedIn: boolean): Promise<string[]> {
  if (!supabase) return []
  if (signedIn) {
    const { data, error } = await supabase.from('follows').select('team_id')
    if (error) return []
    return (data ?? []).map((r: { team_id: string }) => r.team_id)
  }
  const token = await getDeviceToken()
  if (!token) return []
  const { data, error } = await supabase.rpc('device_follows_list', { p_token: token })
  return error || !Array.isArray(data) ? [] : (data as string[])
}

export async function saveRemoteFollows(userId: string | null, teamIds: string[]): Promise<void> {
  if (!supabase) return
  if (!userId) {
    const token = await ensureDeviceToken()
    if (token) await supabase.rpc('device_follows_set', { p_token: token, p_team_ids: teamIds })
    return
  }
  const keep = new Set(teamIds)
  const have = await loadRemoteFollows(true)
  const gone = have.filter((t) => !keep.has(t))
  if (gone.length) await supabase.from('follows').delete().in('team_id', gone)
  // Direct inserts are closed; user_follows_add is capped and skips team ids the database doesn't know (placeholder teams for leagues the seed doesn't cover yet).
  const add = teamIds.filter((t) => !have.includes(t))
  if (add.length) await supabase.rpc('user_follows_add', { p_team_ids: add })
}
