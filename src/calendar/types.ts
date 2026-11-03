// The native calendar plugin contract.
// TODO(native-plugin PR): implement this as a Capacitor plugin. iOS: EventKit with full access (needed to update
// events later; spike open in build-plan M2). Android: CalendarContract. Until then the app uses MockCalendar.
// Fanday keeps its own "Fanday" calendar and stores each returned eventIdentifier per game (device_events table).

export interface CalendarEventInput {
  title: string
  location: string | null
  notes: string
  /** ISO instant. For all-day events this is only used for its date part. */
  startsAt: string
  endsAt: string
  allDay: boolean
  alarmMinutesBefore: number | null
}

export interface StoredEvent extends CalendarEventInput {
  eventIdentifier: string
  calendarId: string
}

export interface CalendarPlugin {
  /** Ask for calendar access. Resolves granted=false if the user says no. */
  requestAccess(): Promise<{ granted: boolean }>
  /** Create the Fanday calendar (or return the existing one with that title). */
  createCalendar(opts: { title: string; colorHex?: string }): Promise<{ calendarId: string }>
  /** Remove the whole calendar and its events (used by "Delete account"). */
  deleteCalendar(calendarId: string): Promise<void>
  /** Create the event, or update it in place when existingIdentifier is given and still exists. */
  upsertEvent(calendarId: string, event: CalendarEventInput, existingIdentifier?: string | null): Promise<{ eventIdentifier: string }>
  deleteEvent(calendarId: string, eventIdentifier: string): Promise<void>
  /** Read back events by the identifiers we stored. Unknown identifiers are simply missing from the result. */
  listEvents(calendarId: string, eventIdentifiers: string[]): Promise<StoredEvent[]>
}
