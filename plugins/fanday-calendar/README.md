# fanday-calendar

Capacitor plugin that writes Fanday's games to the phone's calendar. Contract: `src/calendar/types.ts` (`CalendarPlugin`);
TypeScript adapter: `src/calendar/native.ts`. One dedicated calendar called "Fanday"; every event is found again by the
identifier we stored (`device_events.event_identifier`).

## Safety rule
JS never names a calendar. Native code resolves the one Fanday calendar it created itself (iOS: identifier in UserDefaults, never found by title;
Android: account "Fanday" + ACCOUNT_TYPE_LOCAL + stored id, every by-id write `_ID=? AND CALENDAR_ID=?`) and cannot touch anything else.
`removeOrphans` deletes events in that calendar that are not in the app's sync state.

## iOS (Swift, EventKit)
- Asks for **full access** (`requestFullAccessToEvents`, iOS 17+; `requestAccess(to:)` before that). Write-only access is not enough:
  Apple's docs say write-only access lets the app create events but "can't access any of the existing calendars and events on the
  device, including events your app created", and reads return nothing
  (`EKEventStore.requestWriteOnlyAccessToEvents(completion:)`, developer.apple.com/documentation/eventkit/ekeventstore/requestwriteonlyaccesstoevents(completion:),
  read 2026-11-03). Without reading its own events Fanday could not move a kickoff or delete a cancelled game.
  Full access is described at `.../ekeventstore/requestfullaccesstoevents(completion:)`.
- Calendar source: iCloud, else On My iPhone (local), else the default calendar's source. A new calendar is created if the stored identifier is gone.
- `upsertEvent` updates by `eventIdentifier`; if it no longer exists a new event is created and the new identifier returned.
- Info.plist: `NSCalendarsFullAccessUsageDescription` + legacy `NSCalendarsUsageDescription`, `BGTaskSchedulerPermittedIdentifiers`, `UIBackgroundModes: fetch`.
- Background: `AppDelegate` registers a `BGAppRefreshTask`; it posts a notification the plugin turns into a `syncDue` event. iOS decides if/when it runs.

## Android (Kotlin, CalendarContract)
- Runtime permission READ_CALENDAR + WRITE_CALENDAR (alias `calendar`).
- Local calendar `ACCOUNT_TYPE_LOCAL`, account name "Fanday", created and written through the sync-adapter URI (owned by the app, real deletes).
- Events by `_ID`. Timed events use the phone's zone; all-day events are UTC midnight with an exclusive end one day later.
- Background: none yet. The sync is TypeScript (Supabase fetch + diff), so WorkManager cannot run it in a killed app. Android syncs on open, resume
  and (push PR) a silent FCM push; a periodic job returns only with a native-only sync.

## Build notes
- Android needs a Gradle that runs on the JDK in use. The wrapper is Gradle 9.1.0 because the Android Studio JBR is JDK 25 (8.14.3 cannot run on it).
- iOS has not been compiled (no Xcode on the build machine).
