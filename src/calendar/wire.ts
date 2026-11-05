import type { CalendarEventInput, StoredEvent } from './types.ts'

/** Wire shape of plugins/fanday-calendar. Instants travel as epoch milliseconds so Swift and Kotlin never parse ISO text. */
export interface WireEvent {
  eventIdentifier: string; calendarId: string; title: string; location?: string | null; notes: string
  startMs: number; endMs: number; allDay: boolean; allDayDate?: string; alarmMinutesBefore?: number | null
}
export type WireEventInput = Omit<WireEvent, 'eventIdentifier' | 'calendarId'>

const ms = (iso: string) => {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) throw new Error(`Bad date: ${iso}`)
  return t
}
/** All-day events carry only a calendar date. We use the date part as written (the UTC date of gameDate), never shifted by the phone's zone. */
const datePart = (iso: string) => iso.slice(0, 10)

/** Optional fields are left out (never null): native reads them as "present or absent". Numbers are whole (Long on the Kotlin side). */
export function toWire(e: CalendarEventInput): WireEventInput {
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
