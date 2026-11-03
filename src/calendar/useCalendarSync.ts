import { useEffect } from 'react'
import { App as CapApp } from '@capacitor/app'
import { isNative } from '../lib/env.ts'
import { useStore } from '../store/useStore.ts'
import { calendar } from './index.ts'
import { syncNow } from './runner.ts'

/** Sync on app open, on resume, when the followed teams change, and when the OS wakes the app in the background. */
export function useCalendarSync() {
  const follows = useStore((s) => s.follows)
  const onboarded = useStore((s) => s.onboarded)

  // Open, and whenever the follows change (debounced: toggling several teams in a row syncs once).
  useEffect(() => {
    const t = setTimeout(() => { void syncNow() }, 600)
    return () => clearTimeout(t)
  }, [follows, onboarded])

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void syncNow() }
    document.addEventListener('visibilitychange', onVisible)
    const resume = isNative ? CapApp.addListener('resume', () => { void syncNow() }) : null
    const due = calendar.onSyncDue?.(() => { void syncNow() })
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void resume?.then((h) => h.remove())
      void due?.then((off) => off())
    }
  }, [])
}
