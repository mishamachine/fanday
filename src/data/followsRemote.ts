import { supabase } from '../lib/supabase.ts'

/** Server copy of the user's followed teams (follows table; RLS keys it to auth.uid()). Best effort: local copy wins offline. */
export async function loadRemoteFollows(): Promise<string[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('follows').select('team_id')
  if (error) return []
  return (data ?? []).map((r: { team_id: string }) => r.team_id)
}

export async function saveRemoteFollows(userId: string, teamIds: string[]): Promise<void> {
  if (!supabase) return
  const keep = new Set(teamIds)
  const have = await loadRemoteFollows()
  const gone = have.filter((t) => !keep.has(t))
  if (gone.length) await supabase.from('follows').delete().in('team_id', gone)
  // One row at a time: placeholder teams (leagues the seed doesn't cover yet) don't exist in the database and would fail the whole batch.
  const add = teamIds.filter((t) => !have.includes(t))
  await Promise.allSettled(add.map((team_id) => supabase!.from('follows').insert({ user_id: userId, team_id })))
}
