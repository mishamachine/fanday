import type { Game } from '../data/types.ts'
import type { CalendarPlugin } from './types.ts'
import { toCalendarEvent, type EventContext } from './eventContent.ts'
import { planSync, revision, type DesiredEvent, type DeviceState } from './diff.ts'

export const CALENDAR_TITLE = 'Fanday'
export const CALENDAR_COLOR = '#0F5E5A'

export interface SyncStats { created: number; updated: number; recreated: number; removed: number; unchanged: number; retained: number; orphans: number; failed: number }
export interface SyncResult { granted: boolean; calendarId: string | null; state: DeviceState; stats: SyncStats }

const noStats = (): SyncStats => ({ created: 0, updated: 0, recreated: 0, removed: 0, unchanged: 0, retained: 0, orphans: 0, failed: 0 })

/**
 * Make the Fanday calendar match `games`. Idempotent: a second run with the same input changes nothing.
 * Cancelled games are not wanted. Moved kickoffs update the same event; vanished events are written again;
 * unfollowed or cancelled games are deleted, but played games that merely fell out of the fetch window stay as history
 * (see planSync). Finally every event in the Fanday calendar that is not in our state is swept away (duplicates, identifiers
 * the OS changed). Nothing outside the Fanday calendar is ever touched. One failing event never stops the others: it keeps its old state
 * and is retried on the next run.
 */
export async function syncGames(cal: CalendarPlugin, games: Game[], state: DeviceState, ctx: EventContext, windowStartMs = Number.NEGATIVE_INFINITY): Promise<SyncResult> {
  const stats = noStats()
  const { granted } = await cal.requestAccess()
  if (!granted) return { granted: false, calendarId: null, state, stats }
  const { calendarId } = await cal.createCalendar({ title: CALENDAR_TITLE, colorHex: CALENDAR_COLOR })

  const desired: DesiredEvent[] = games.filter((g) => g.status !== 'cancelled').map((g) => {
    const event = toCalendarEvent(g, ctx)
    return { gameId: g.id, event, rev: revision(event) }
  })
  const stored = Object.values(state).map((d) => d.eventIdentifier)
  const present = new Set((stored.length ? await cal.listEvents(calendarId, stored) : []).map((e) => e.eventIdentifier))
  const plan = planSync(desired, state, present, windowStartMs)

  const next: DeviceState = { ...state }
  const write = async (d: DesiredEvent, existing: string | null, bump: 'created' | 'updated' | 'recreated') => {
    try {
      const { eventIdentifier } = await cal.upsertEvent(calendarId, d.event, existing)
      next[d.gameId] = { eventIdentifier, rev: d.rev, endsAt: d.event.endsAt }
      stats[bump]++
    } catch { stats.failed++ }
  }
  for (const d of plan.create) await write(d, null, 'created')
  for (const d of plan.update) await write(d, d.eventIdentifier, 'updated')
  for (const d of plan.recreate) await write(d, null, 'recreated')
  for (const r of plan.remove) {
    try {
      if (present.has(r.eventIdentifier)) await cal.deleteEvent(calendarId, r.eventIdentifier)
      delete next[r.gameId]
      stats.removed++
    } catch { stats.failed++ }
  }
  stats.unchanged = plan.unchanged.length
  stats.retained = plan.retained.length
  if (cal.removeOrphans && stats.failed === 0) {
    try { stats.orphans = await cal.removeOrphans(calendarId, Object.values(next).map((d) => d.eventIdentifier)) } catch { stats.failed++ }
  }
  return { granted: true, calendarId, state: next, stats }
}
