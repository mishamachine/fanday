import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import { loadRemoteFollows, saveRemoteFollows } from '../data/followsRemote.ts'
import { isAnonymous } from '../lib/auth.ts'
import type { DeviceState } from '../calendar/diff.ts'
import type { SyncStatus } from '../calendar/status.ts'

const KEY = 'fanday.v1'
interface Persisted { follows: string[]; onboarded: boolean; eventState: DeviceState; calendarId: string | null; deviceId: string | null; changeAlerts: boolean; rationaleSeen: boolean }
const DEFAULTS: Persisted = { follows: [], onboarded: false, eventState: {}, calendarId: null, deviceId: null, changeAlerts: true, rationaleSeen: false }

function load(): Persisted {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { return DEFAULTS }
}
function save(p: Persisted) { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* private mode: in-memory only */ } }

interface State extends Persisted {
  user: User | null
  syncStatus: SyncStatus
  syncFailed: number
  setSyncStatus(s: SyncStatus, failed?: number): void
  /** The user saw the in-app explanation and tapped Continue: the OS prompt may now appear. */
  markRationaleSeen(): void
  setUser(u: User | null): void
  toggleTeam(id: string): void
  finishOnboarding(): void
  setSync(eventState: DeviceState, calendarId: string | null, deviceId: string | null): void
  setChangeAlerts(v: boolean): void
  /** After sign-in: pull the server's follows in (union with local), so a new phone gets the old teams. */
  pullFollows(): Promise<void>
  reset(): void
}

const persistKeys = (s: State): Persisted =>
  ({ follows: s.follows, onboarded: s.onboarded, eventState: s.eventState, calendarId: s.calendarId, deviceId: s.deviceId, rationaleSeen: s.rationaleSeen, changeAlerts: s.changeAlerts })

export const useStore = create<State>((set, get) => {
  const commit = (patch: Partial<Persisted>) => { set(patch); save(persistKeys(get())); void pushFollows() }
  const pushFollows = async () => {
    const u = get().user
    if (u) await saveRemoteFollows(u.id, get().follows).catch(() => undefined)
  }
  return {
    ...load(),
    user: null,
    syncStatus: 'idle',
    syncFailed: 0,
    setSyncStatus: (syncStatus, failed = 0) => set({ syncStatus, syncFailed: failed }),
    markRationaleSeen: () => { set({ rationaleSeen: true }); save(persistKeys(get())) },
    setUser: (user) => set({ user }),
    toggleTeam: (id) => {
      const f = get().follows
      commit({ follows: f.includes(id) ? f.filter((x) => x !== id) : [...f, id] })
    },
    finishOnboarding: () => commit({ onboarded: true }),
    setSync: (eventState, calendarId, deviceId) => { set({ eventState, calendarId, deviceId }); save(persistKeys(get())) }, // local only: no follows push
    setChangeAlerts: (changeAlerts) => commit({ changeAlerts }),
    pullFollows: async () => {
      const u = get().user
      if (!u || isAnonymous(u)) return
      const remote = await loadRemoteFollows()
      const merged = Array.from(new Set([...get().follows, ...remote]))
      commit({ follows: merged, onboarded: get().onboarded || merged.length > 0 })
    },
    reset: () => { try { localStorage.removeItem(KEY) } catch { /* ignore */ } set({ ...DEFAULTS }) },
  }
})
