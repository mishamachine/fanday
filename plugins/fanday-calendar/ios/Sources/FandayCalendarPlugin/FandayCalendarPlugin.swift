import Foundation
import EventKit
import BackgroundTasks
import Capacitor

/// Posted by AppDelegate when iOS runs our BGAppRefresh task. The plugin turns it into a `syncDue` event for JS.
public extension Notification.Name {
    static let fandayBackgroundRefresh = Notification.Name("FandayBackgroundRefresh")
}

/// Same string as BGTaskSchedulerPermittedIdentifiers in Info.plist and the registration in AppDelegate.
public let fandayRefreshTaskId = "com.bbprojectfactory.fanday.refresh"

/// Device calendar for Fanday (iOS, EventKit). One dedicated "Fanday" calendar; events are found by the
/// eventIdentifier JS stored. Full access is required (iOS 17+ requestFullAccessToEvents): with write-only access
/// the app "can't access any of the existing calendars and events on the device, including events your app created",
/// so it could never update a moved kickoff or delete an event. Apple, EKEventStore.requestWriteOnlyAccessToEvents(completion:).
@objc(FandayCalendarPlugin)
public class FandayCalendarPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FandayCalendarPlugin"
    public let jsName = "FandayCalendar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createCalendar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteCalendar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "upsertEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeOrphans", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleBackgroundSync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelBackgroundSync", returnType: CAPPluginReturnPromise)
    ]

    private var store = EKEventStore()
    private let calendarIdKey = "FandayCalendarId"

    override public func load() {
        NotificationCenter.default.addObserver(forName: .fandayBackgroundRefresh, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("syncDue", data: [:])
        }
    }

    // MARK: access

    private var hasFullAccess: Bool {
        let s = EKEventStore.authorizationStatus(for: .event)
        if #available(iOS 17.0, *) { return s == .fullAccess }
        return s == .authorized
    }

    @objc func requestAccess(_ call: CAPPluginCall) {
        if hasFullAccess { call.resolve(["granted": true]); return }
        let done: (Bool, Error?) -> Void = { [weak self] granted, _ in
            // Per Apple: reset the store after the first grant so it returns data.
            if granted { self?.store = EKEventStore() }
            call.resolve(["granted": granted])
        }
        if #available(iOS 17.0, *) { store.requestFullAccessToEvents(completion: done) }
        else { store.requestAccess(to: .event, completion: done) }
    }

    private func guardAccess(_ call: CAPPluginCall) -> Bool {
        if hasFullAccess { return true }
        call.reject("Calendar access has not been granted.", "NO_ACCESS")
        return false
    }

    // MARK: calendar
    // Safety rule: JS never names a calendar. Everything below works on the one calendar whose identifier THIS plugin
    // stored when it created it (UserDefaults). It is never found by title, so a user's own "Fanday" calendar is never adopted.

    /// iCloud first, then On My iPhone (local), then whatever the user's default calendar lives in.
    private func candidateSources() -> [EKSource] {
        var out: [EKSource] = []
        if let icloud = store.sources.first(where: { $0.sourceType == .calDAV && $0.title == "iCloud" }) { out.append(icloud) }
        if let local = store.sources.first(where: { $0.sourceType == .local }) { out.append(local) }
        if let def = store.defaultCalendarForNewEvents?.source, !out.contains(where: { $0.sourceIdentifier == def.sourceIdentifier }) { out.append(def) }
        return out
    }

    private func ourCalendar() -> EKCalendar? {
        guard let id = UserDefaults.standard.string(forKey: calendarIdKey), let c = store.calendar(withIdentifier: id), c.allowsContentModifications else { return nil }
        return c
    }

    private func isOurs(_ ev: EKEvent) -> Bool {
        guard let id = UserDefaults.standard.string(forKey: calendarIdKey) else { return false }
        return ev.calendar?.calendarIdentifier == id
    }

    @objc func createCalendar(_ call: CAPPluginCall) {
        guard guardAccess(call) else { return }
        if let cal = ourCalendar() { call.resolve(["calendarId": cal.calendarIdentifier]); return }
        let title = call.getString("title") ?? "Fanday"
        for source in candidateSources() {
            let cal = EKCalendar(for: .event, eventStore: store)
            cal.title = title
            cal.source = source
            if let hex = call.getString("colorHex"), let c = Self.color(hex: hex) { cal.cgColor = c }
            do {
                try store.saveCalendar(cal, commit: true)
                UserDefaults.standard.set(cal.calendarIdentifier, forKey: calendarIdKey)
                call.resolve(["calendarId": cal.calendarIdentifier])
                return
            } catch { continue } // e.g. iCloud calendars switched off: try the next source
        }
        call.reject("Could not create the Fanday calendar on this device.", "NO_SOURCE")
    }

    @objc func deleteCalendar(_ call: CAPPluginCall) {
        guard guardAccess(call) else { return }
        if let cal = ourCalendar() {
            do { try store.removeCalendar(cal, commit: true) } catch { call.reject("Could not remove the calendar: \(error.localizedDescription)"); return }
        }
        UserDefaults.standard.removeObject(forKey: calendarIdKey)
        call.resolve()
    }

    // MARK: events

    @objc func upsertEvent(_ call: CAPPluginCall) {
        guard guardAccess(call) else { return }
        guard let cal = ourCalendar() else { call.reject("No Fanday calendar", "NO_CALENDAR"); return }
        guard let title = call.getString("title"), let startMs = call.getDouble("startMs"), let endMs = call.getDouble("endMs") else { call.reject("title, startMs and endMs are required"); return }
        let allDay = call.getBool("allDay") ?? false

        // Update in place only when the stored identifier is one of OUR events; anything else (gone, or someone else's) makes a new event.
        var event: EKEvent? = nil
        if let existing = call.getString("existingIdentifier"), let found = store.event(withIdentifier: existing), isOurs(found) { event = found }
        let ev = event ?? EKEvent(eventStore: store)
        ev.calendar = cal
        ev.title = title
        ev.location = call.getString("location")
        ev.notes = call.getString("notes")
        if allDay {
            // All-day events are a calendar DATE (the game date), not an instant: build local midnight from "YYYY-MM-DD".
            guard let day = call.getString("allDayDate"), let d = Self.localDate(day) else { call.reject("allDayDate (YYYY-MM-DD) is required for all-day events"); return }
            ev.isAllDay = true
            ev.startDate = d
            ev.endDate = d
            ev.timeZone = nil
            ev.alarms = nil
        } else {
            ev.isAllDay = false
            ev.timeZone = TimeZone.current // timed events are absolute instants; the phone shows them in its own zone
            ev.startDate = Date(timeIntervalSince1970: startMs / 1000)
            ev.endDate = Date(timeIntervalSince1970: endMs / 1000)
            if let mins = call.getInt("alarmMinutesBefore") { ev.alarms = [EKAlarm(relativeOffset: -Double(mins) * 60)] } else { ev.alarms = nil }
        }
        do {
            try store.save(ev, span: .thisEvent, commit: true)
            call.resolve(["eventIdentifier": ev.eventIdentifier ?? ""])
        } catch { call.reject("Could not save the event: \(error.localizedDescription)") }
    }

    @objc func deleteEvent(_ call: CAPPluginCall) {
        guard guardAccess(call) else { return }
        guard let id = call.getString("eventIdentifier") else { call.reject("eventIdentifier is required"); return }
        if let ev = store.event(withIdentifier: id) {
            guard isOurs(ev) else { call.reject("That event is not in the Fanday calendar.", "NOT_OURS"); return }
            do { try store.remove(ev, span: .thisEvent, commit: true) } catch { call.reject("Could not delete the event: \(error.localizedDescription)"); return }
        }
        call.resolve() // already gone is fine
    }

    @objc func listEvents(_ call: CAPPluginCall) {
        guard guardAccess(call) else { return }
        guard let cal = ourCalendar() else { call.resolve(["events": []]); return }
        let ids = call.getArray("eventIdentifiers", String.self) ?? []
        var out: [JSObject] = []
        for id in ids {
            guard let ev = store.event(withIdentifier: id), isOurs(ev) else { continue }
            var o: JSObject = [
                "eventIdentifier": ev.eventIdentifier ?? id, "calendarId": cal.calendarIdentifier, "title": ev.title ?? "", "notes": ev.notes ?? "",
                "startMs": ev.startDate.timeIntervalSince1970 * 1000, "endMs": ev.endDate.timeIntervalSince1970 * 1000, "allDay": ev.isAllDay
            ]
            if let loc = ev.location { o["location"] = loc }
            if ev.isAllDay { o["allDayDate"] = Self.localDay(ev.startDate) }
            if let a = ev.alarms?.first { o["alarmMinutesBefore"] = Int((-a.relativeOffset / 60).rounded()) }
            out.append(o)
        }
        call.resolve(["events": out])
    }

    /// Delete events in OUR calendar whose identifier is not in `keep` (duplicates, or identifiers iCloud changed under us).
    /// EventKit predicates span at most 4 years, so this sweeps 2 years back to 2 years ahead.
    @objc func removeOrphans(_ call: CAPPluginCall) {
        guard guardAccess(call) else { return }
        guard let cal = ourCalendar() else { call.resolve(["removed": 0]); return }
        let keep = Set(call.getArray("keep", String.self) ?? [])
        let now = Date()
        let pred = store.predicateForEvents(withStart: now.addingTimeInterval(-2 * 365 * 86400), end: now.addingTimeInterval(2 * 365 * 86400), calendars: [cal])
        var removed = 0
        for ev in store.events(matching: pred) where isOurs(ev) && !keep.contains(ev.eventIdentifier ?? "") {
            if (try? store.remove(ev, span: .thisEvent, commit: false)) != nil { removed += 1 }
        }
        do { try store.commit() } catch { call.reject("Could not commit the sweep: \(error.localizedDescription)"); return }
        call.resolve(["removed": removed])
    }

    // MARK: background (best effort; iOS decides if and when it runs)

    @objc func scheduleBackgroundSync(_ call: CAPPluginCall) {
        let minutes = call.getInt("intervalMinutes") ?? 15
        let req = BGAppRefreshTaskRequest(identifier: fandayRefreshTaskId)
        req.earliestBeginDate = Date(timeIntervalSinceNow: Double(max(minutes, 15)) * 60)
        do { try BGTaskScheduler.shared.submit(req) } catch { /* simulator, Background App Refresh off, or not registered: best effort */ }
        call.resolve()
    }

    @objc func cancelBackgroundSync(_ call: CAPPluginCall) {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: fandayRefreshTaskId)
        call.resolve()
    }

    // MARK: helpers

    private static func localDate(_ ymd: String) -> Date? {
        let p = ymd.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))
    }

    private static func localDay(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    private static func color(hex: String) -> CGColor? {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        return CGColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }
}
