import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { CalendarEventInput, CalendarPlugin, StoredEvent } from './types.ts'

/** Wire shape of plugins/fanday-calendar. Instants travel as epoch milliseconds so Swift and Kotlin never parse ISO text. */
interface WireEvent {
  eventIdentifier: string; calendarId: string; title: string; location?: string | null; notes: string
  startMs: number; endMs: number; allDay: boolean; allDayDate?: string; alarmMinutesBefore?: number | null
}
interface Native {
  requestAccess(): Promise<{ granted: boolean }>
  createCalendar(o: { title: string; colorHex?: string }): Promise<{ calendarId: string }>
  deleteCalendar(o: { calendarId: string }): Promise<void>
  upsertEvent(o: Omit<WireEvent, 'eventIdentifier' | 'calendarId'> & { calendarId: string; existingIdentifier?: string }): Promise<{ eventIdentifier: string }>
  deleteEvent(o: { calendarId: string; eventIdentifier: string }): Promise<void>
  listEvents(o: { calendarId: string; eventIdentifiers: string[] }): Promise<{ events: WireEvent[] }>
  scheduleBackgroundSync(o: { intervalMinutes: number }): Promise<void>
  cancelBackgroundSync(): Promise<void>
  addListener(name: 'syncDue', cb: () => void): Promise<PluginListenerHandle>
}

const plugin = registerPlugin<Native>('FandayCalendar')

const ms = (iso: string) => {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) throw new Error(`Bad date: ${iso}`)
  return t
}
/** All-day events carry only a calendar date. We use the date part as written (the UTC date of gameDate), never shifted by the phone's zone. */
const datePart = (iso: string) => iso.slice(0, 10)

export function toWire(e: CalendarEventInput): Omit<WireEvent, 'eventIdentifier' | 'calendarId'> {
  return {
    title: e.title, location: e.location ?? undefined, notes: e.notes, startMs: ms(e.startsAt), endMs: ms(e.endsAt),
    allDay: e.allDay, allDayDate: e.allDay ? datePart(e.startsAt) : undefined, alarmMinutesBefore: e.alarmMinutesBefore ?? undefined,
  }
}

export function fromWire(w: WireEvent): StoredEvent {
  const startsAt = w.allDay && w.allDayDate ? `${w.allDayDate}T00:00:00.000Z` : new Date(w.startMs).toISOString()
  return {
    eventIdentifier: w.eventIdentifier, calendarId: w.calendarId, title: w.title, location: w.location || null, notes: w.notes ?? '',
    startsAt, endsAt: w.allDay ? startsAt : new Date(w.endMs).toISOString(), allDay: w.allDay, alarmMinutesBefore: w.alarmMinutesBefore ?? null,
  }
}

export class NativeCalendar implements CalendarPlugin {
  requestAccess() { return plugin.requestAccess() }
  createCalendar(opts: { title: string; colorHex?: string }) { return plugin.createCalendar(opts) }
  async deleteCalendar(calendarId: string) { await plugin.deleteCalendar({ calendarId }) }
  upsertEvent(calendarId: string, event: CalendarEventInput, existingIdentifier?: string | null) {
    return plugin.upsertEvent({ calendarId, existingIdentifier: existingIdentifier ?? undefined, ...toWire(event) })
  }
  async deleteEvent(calendarId: string, eventIdentifier: string) { await plugin.deleteEvent({ calendarId, eventIdentifier }) }
  async listEvents(calendarId: string, eventIdentifiers: string[]) {
    return (await plugin.listEvents({ calendarId, eventIdentifiers })).events.map(fromWire)
  }
  async scheduleBackgroundSync(intervalMinutes: number) { await plugin.scheduleBackgroundSync({ intervalMinutes }) }
  async cancelBackgroundSync() { await plugin.cancelBackgroundSync() }
  async onSyncDue(cb: () => void) { const h = await plugin.addListener('syncDue', cb); return () => { void h.remove() } }
}
