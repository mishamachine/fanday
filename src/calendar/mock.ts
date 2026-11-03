import type { CalendarEventInput, CalendarPlugin, StoredEvent } from './types.ts'

/** In-memory CalendarPlugin for the web build, previews and tests. Nothing touches a real calendar. */
export class MockCalendar implements CalendarPlugin {
  private calendars = new Map<string, string>() // id -> title
  private events = new Map<string, StoredEvent>()
  private seq = 0
  accessGranted = true

  async requestAccess() { return { granted: this.accessGranted } }

  async createCalendar(opts: { title: string }) {
    for (const [id, title] of this.calendars) if (title === opts.title) return { calendarId: id }
    const calendarId = `mock-cal-${++this.seq}`
    this.calendars.set(calendarId, opts.title)
    return { calendarId }
  }

  async deleteCalendar(calendarId: string) {
    this.calendars.delete(calendarId)
    for (const [id, e] of this.events) if (e.calendarId === calendarId) this.events.delete(id)
  }

  async upsertEvent(calendarId: string, event: CalendarEventInput, existingIdentifier?: string | null) {
    if (!this.calendars.has(calendarId)) throw new Error('No such calendar')
    const prior = existingIdentifier ? this.events.get(existingIdentifier) : undefined
    const eventIdentifier = prior ? prior.eventIdentifier : `mock-ev-${++this.seq}`
    this.events.set(eventIdentifier, { ...event, eventIdentifier, calendarId })
    return { eventIdentifier }
  }

  async deleteEvent(_calendarId: string, eventIdentifier: string) { this.events.delete(eventIdentifier) }

  async listEvents(calendarId: string, ids: string[]) {
    return ids.map((i) => this.events.get(i)).filter((e): e is StoredEvent => !!e && e.calendarId === calendarId)
  }
}
