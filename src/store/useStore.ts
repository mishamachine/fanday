import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import { loadRemoteFollows, saveRemoteFollows } from '../data/followsRemote.ts'
import { isAnonymous } from '../lib/auth.ts'
import type { IdentifierMap } from '../calendar/sync.ts'

const KEY = 'fanday.v1'
interface Persisted { follows: string[]; onboarded: boolean; eventIds: IdentifierMap; calendarId: string | null; changeAlerts: boolean }
const DEFAULTS: Persisted = { follows: [], onboarded: false, eventIds: {}, calendarId: null, changeAlerts: true }

function load(): Persisted {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { return DEFAULTS }
}
function save(p: Persisted) { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* private mode: in-memory only */ } }

interface State extends Persisted {
  user: User | null
  setUser(u: User | null): void
  toggleTeam(id: string): void
  finishOnboarding(): void
  setSync(eventIds: IdentifierMap, calendarId: string | null): void
  setChangeAlerts(v: boolean): void
  /** After sign-in: pull the server's follows in (union with local), so a new phone gets the old teams. */
  pullFollows(): Promise<void>
  reset(): void
}

const persistKeys = (s: State): Persisted =>
  ({ follows: s.follows, onboarded: s.onboarded, eventIds: s.eventIds, calendarId: s.calendarId, changeAlerts: s.changeAlerts })

export const useStore = create<State>((set, get) => {
  const commit = (patch: Partial<Persisted>) => { set(patch); save(persistKeys(get())); void pushFollows() }
  const pushFollows = async () => {
    const u = get().user
    if (u) await saveRemoteFollows(u.id, get().follows).catch(() => undefined)
  }
  return {
    ...load(),
    user: null,
    setUser: (user) => set({ user }),
    toggleTeam: (id) => {
      const f = get().follows
      commit({ follows: f.includes(id) ? f.filter((x) => x !== id) : [...f, id] })
    },
    finishOnboarding: () => commit({ onboarded: true }),
    setSync: (eventIds, calendarId) => commit({ eventIds, calendarId }),
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
