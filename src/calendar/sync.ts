import type { Game } from '../data/types.ts'
import type { CalendarPlugin } from './types.ts'
import { toCalendarEvent, type EventContext } from './eventContent.ts'

/** gameId -> eventIdentifier. Persisted per device (device_events table once the native plugin lands). */
export type IdentifierMap = Record<string, string>

/**
 * Write every game to the Fanday calendar. Existing events are updated in place (so a moved kickoff changes the
 * same event); cancelled games are removed; events for games no longer followed are deleted.
 */
export async function syncGames(
  cal: CalendarPlugin, games: Game[], ids: IdentifierMap, ctx: EventContext,
): Promise<{ ids: IdentifierMap; calendarId: string | null; granted: boolean }> {
  const { granted } = await cal.requestAccess()
  if (!granted) return { ids, calendarId: null, granted: false }
  const { calendarId } = await cal.createCalendar({ title: 'Fanday', colorHex: '#0F5E5A' })
  const next: IdentifierMap = {}
  for (const g of games) {
    if (g.status === 'cancelled') continue
    const { eventIdentifier } = await cal.upsertEvent(calendarId, toCalendarEvent(g, ctx), ids[g.id])
    next[g.id] = eventIdentifier
  }
  for (const [gameId, ev] of Object.entries(ids)) if (!(gameId in next)) await cal.deleteEvent(calendarId, ev)
  return { ids: next, calendarId, granted: true }
}
