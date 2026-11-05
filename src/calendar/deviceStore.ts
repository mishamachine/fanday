import { supabase } from '../lib/supabase.ts'
import { DATA_SOURCE, platform } from '../lib/env.ts'
import type { DeviceState } from './diff.ts'

// Server copy of what this device wrote (devices + device_events, RLS: own rows only). Best effort: the local copy in
// the store is what drives the diff; these rows let us see and restore it. Skipped with the mock data source, whose
// game ids are not rows in `games` (device_events.game_id is a foreign key).
const enabled = () => !!supabase && DATA_SOURCE === 'supabase'

export const newDeviceId = () => crypto.randomUUID()

export async function pushDeviceState(userId: string, deviceId: string, calendarId: string, before: DeviceState, after: DeviceState): Promise<void> {
  if (!enabled()) return
  const sb = supabase!
  try {
    const { error } = await sb.from('devices').upsert({ id: deviceId, user_id: userId, platform, calendar_id: calendarId, last_sync_at: new Date().toISOString() })
    if (error) return
    const changed = Object.entries(after).filter(([g, d]) => before[g]?.eventIdentifier !== d.eventIdentifier || before[g]?.rev !== d.rev)
      .map(([game_id, d]) => ({ device_id: deviceId, game_id, event_identifier: d.eventIdentifier, synced_rev: d.rev }))
    if (changed.length) await sb.from('device_events').upsert(changed)
    const gone = Object.keys(before).filter((g) => !(g in after))
    if (gone.length) await sb.from('device_events').delete().eq('device_id', deviceId).in('game_id', gone)
  } catch { /* offline: the next sync pushes it */ }
}

/** Forget this device on the server (sign-out / delete). device_events go with it by cascade. */
export async function deleteDeviceRows(deviceId: string): Promise<void> {
  if (!enabled()) return
  try { await supabase!.from('devices').delete().eq('id', deviceId) } catch { /* best effort */ }
}
