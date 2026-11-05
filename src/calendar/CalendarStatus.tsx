import { useStore } from '../store/useStore.ts'
import { calendar } from './index.ts'
import { syncNow } from './runner.ts'
import { statusText } from './status.ts'

export const RATIONALE = "Fanday adds your games to a 'Fanday' calendar on this phone and keeps times up to date. It never reads your other calendars."

/** The calendar line on the games screen: progress, failures, the pre-permission explanation, and the denied state. */
export default function CalendarStatus() {
  const status = useStore((s) => s.syncStatus)
  const failed = useStore((s) => s.syncFailed)
  const markRationaleSeen = useStore((s) => s.markRationaleSeen)

  if (status === 'rationale') {
    return (
      <section className="card" aria-label="Calendar access">
        <h2>Add games to your calendar</h2>
        <p>{RATIONALE}</p>
        <button className="btn" onClick={() => { markRationaleSeen(); void syncNow() /* the OS prompt appears here */ }}>Continue</button>
      </section>
    )
  }
  if (status === 'denied') {
    return (
      <section className="card" aria-label="Calendar access">
        <p role="status"><span className="dot" />{statusText('denied')}. Turn it on in Settings so Fanday can add your games.</p>
        {calendar.openSettings && <button className="btn alt" onClick={() => void calendar.openSettings?.()}>Open Settings</button>}
      </section>
    )
  }
  const text = statusText(status, failed)
  if (!text) return null
  return <p className={status === 'partial' || status === 'error' ? 'err' : 'sync'} role="status">{status === 'ok' || status === 'syncing' ? <span className="dot" /> : null}{text}</p>
}
