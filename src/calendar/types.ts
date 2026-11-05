// The native calendar plugin contract. Implemented by plugins/fanday-calendar (iOS EventKit with full access, Android
// CalendarContract); the web build and the tests use MockCalendar. Fanday keeps its own "Fanday" calendar and stores
// each returned eventIdentifier per game (device_events table).

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
  /** Native only: current permission without prompting. 'denied' means the OS will not prompt again (open Settings). */
  checkAccess?(): Promise<'granted' | 'denied' | 'prompt'>
  /** Native only: open this app's page in the system Settings. */
  openSettings?(): Promise<void>
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
  /** Delete events in the Fanday calendar that start at or after `fromMs` (default: all) and whose identifier is not in `keep` (duplicates, identifiers the OS changed). Returns how many. */
  removeOrphans?(calendarId: string, keep: string[], fromMs?: number): Promise<number>
  /** Native only: ask the OS to wake the app roughly every N minutes (Android >= 15, iOS best effort) and fire onSyncDue. */
  scheduleBackgroundSync?(intervalMinutes: number): Promise<void>
  cancelBackgroundSync?(): Promise<void>
  /** Native only: the OS woke us for a background sync. Returns an unsubscribe function. */
  onSyncDue?(cb: () => void): Promise<() => void>
}
