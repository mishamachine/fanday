import { data } from '../data/index.ts'
import { FUNCTIONS_URL, platform } from '../lib/env.ts'
import { useStore } from '../store/useStore.ts'
import { calendar } from './index.ts'
import { syncGames, type SyncStats } from './sync.ts'
import { singleFlight } from './singleFlight.ts'
import { deleteDeviceRows, newDeviceId, pushDeviceState } from './deviceStore.ts'

/** Games from yesterday (so a match in progress stays) to 180 days ahead. */
export const WINDOW_BACK_DAYS = 1
export const WINDOW_AHEAD_DAYS = 180
export const BACKGROUND_INTERVAL_MIN = 15 // iOS BGAppRefresh earliest start. Android has no background job until a native-only sync exists; it syncs on open, resume and (push PR) a silent push.

export type SyncOutcome = { granted: boolean; stats: SyncStats } | null

/**
 * One sync pass, shared by app open, resume, follow changes and the background wake-up. A request made while a pass is
 * running queues exactly one more pass (so a follow change during a sync is not missed). Does nothing (and never asks
 * for calendar access) until the user has followed a team.
 */
export const syncNow = singleFlight(() => run())

async function run(): Promise<SyncOutcome> {
  const st = useStore.getState()
  const hasState = Object.keys(st.eventState).length > 0
  if (!st.onboarded || (!st.follows.length && !hasState)) return null
  st.setSyncStatus('syncing')
  try {
    // Games that ended before this are outside the fetch, not gone: their events stay as history.
    const windowStart = Date.parse(new Date(Date.now() - WINDOW_BACK_DAYS * 86_400_000).toISOString().slice(0, 10))
    const games = st.follows.length ? await data.listGames(st.follows, new Date(), WINDOW_AHEAD_DAYS) : []
    const res = await syncGames(calendar, games, st.eventState, { goBaseUrl: FUNCTIONS_URL }, windowStart)
    if (!res.granted || !res.calendarId) { useStore.getState().setSyncStatus('denied'); return { granted: false, stats: res.stats } }
    const deviceId = st.deviceId ?? newDeviceId()
    useStore.getState().setSync(res.state, res.calendarId, deviceId)
    useStore.getState().setSyncStatus('ok')
    const user = useStore.getState().user
    if (user) await pushDeviceState(user.id, deviceId, res.calendarId, st.eventState, res.state)
    if (platform === 'ios') void calendar.scheduleBackgroundSync?.(BACKGROUND_INTERVAL_MIN).catch(() => undefined)
    return { granted: true, stats: res.stats }
  } catch {
    useStore.getState().setSyncStatus('error')
    return null
  }
}

/**
 * Take Fanday off this phone: delete the "Fanday" calendar with all its events, stop background wake-ups, and forget the
 * device rows. Called on sign-out and before delete-account. Never throws, so it cannot block either.
 */
export async function removeFandayCalendar(): Promise<void> {
  const { calendarId, deviceId } = useStore.getState()
  if (platform === 'ios') await calendar.cancelBackgroundSync?.().catch(() => undefined)
  if (calendarId) await calendar.deleteCalendar(calendarId).catch(() => undefined)
  if (deviceId) await deleteDeviceRows(deviceId)
  useStore.getState().setSync({}, null, null)
}
