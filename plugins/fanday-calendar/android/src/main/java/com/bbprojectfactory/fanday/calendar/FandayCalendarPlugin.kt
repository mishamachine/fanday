package com.bbprojectfactory.fanday.calendar

import android.Manifest
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/** Device calendar for Fanday (Android, CalendarContract). One local "Fanday" calendar owned by the app; events by _ID. */
@CapacitorPlugin(
    name = "FandayCalendar",
    permissions = [Permission(strings = [Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR], alias = "calendar")],
)
class FandayCalendarPlugin : Plugin() {
    private val store by lazy { CalendarStore(context.contentResolver) }

    override fun load() { live = this }
    override fun handleOnDestroy() { if (live === this) live = null }

    fun fireSyncDue() { notifyListeners("syncDue", JSObject()) }

    private fun hasAccess() = getPermissionState("calendar") == PermissionState.GRANTED

    @PluginMethod
    fun requestAccess(call: PluginCall) {
        if (hasAccess()) call.resolve(JSObject().put("granted", true))
        else requestPermissionForAlias("calendar", call, "accessResult")
    }

    @PermissionCallback
    private fun accessResult(call: PluginCall) { call.resolve(JSObject().put("granted", hasAccess())) }

    /** Runs [body] off the main thread's concern: any failure becomes a rejected promise, never a crash. */
    private fun guarded(call: PluginCall, body: () -> Unit) {
        if (!hasAccess()) { call.reject("Calendar access has not been granted.", "NO_ACCESS"); return }
        try { body() } catch (e: Exception) { call.reject(e.message ?: "Calendar error", e) }
    }

    private fun id(call: PluginCall, key: String): Long? = call.getString(key)?.toLongOrNull()

    @PluginMethod
    fun createCalendar(call: PluginCall) = guarded(call) {
        val calId = store.ensureCalendar(call.getString("title") ?: "Fanday", call.getString("colorHex"))
        call.resolve(JSObject().put("calendarId", calId.toString()))
    }

    @PluginMethod
    fun deleteCalendar(call: PluginCall) = guarded(call) {
        val calId = id(call, "calendarId") ?: return@guarded call.reject("calendarId is required")
        store.deleteCalendar(calId)
        call.resolve()
    }

    @PluginMethod
    fun upsertEvent(call: PluginCall) = guarded(call) {
        val calId = id(call, "calendarId") ?: return@guarded call.reject("calendarId is required")
        if (!store.calendarExists(calId)) return@guarded call.reject("No such calendar", "NO_CALENDAR")
        val data = EventData(
            title = call.getString("title") ?: return@guarded call.reject("title is required"),
            location = call.getString("location"),
            notes = call.getString("notes") ?: "",
            startMs = call.getDouble("startMs")?.toLong() ?: return@guarded call.reject("startMs is required"),
            endMs = call.getDouble("endMs")?.toLong() ?: return@guarded call.reject("endMs is required"),
            allDay = call.getBoolean("allDay", false) ?: false,
            allDayDate = call.getString("allDayDate"),
            alarmMinutesBefore = call.getInt("alarmMinutesBefore"),
        )
        val eventId = store.upsert(calId, data, id(call, "existingIdentifier"))
        call.resolve(JSObject().put("eventIdentifier", eventId.toString()))
    }

    @PluginMethod
    fun deleteEvent(call: PluginCall) = guarded(call) {
        val eventId = id(call, "eventIdentifier") ?: return@guarded call.reject("eventIdentifier is required")
        store.delete(eventId) // already gone is fine
        call.resolve()
    }

    @PluginMethod
    fun listEvents(call: PluginCall) = guarded(call) {
        val calId = id(call, "calendarId") ?: return@guarded call.reject("calendarId is required")
        val ids = (call.getArray("eventIdentifiers") ?: JSArray()).toList<String>().mapNotNull { it.toLongOrNull() }
        val events = JSArray()
        for (r in store.list(calId, ids)) {
            val o = JSObject()
                .put("eventIdentifier", r.id.toString()).put("calendarId", r.calendarId.toString())
                .put("title", r.title).put("notes", r.notes)
                .put("startMs", r.startMs).put("endMs", r.endMs).put("allDay", r.allDay)
            if (r.location != null) o.put("location", r.location)
            if (r.allDay) o.put("allDayDate", java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(java.util.Date(r.startMs)))
            if (r.alarmMinutesBefore != null) o.put("alarmMinutesBefore", r.alarmMinutesBefore)
            events.put(o)
        }
        call.resolve(JSObject().put("events", events))
    }

    @PluginMethod
    fun scheduleBackgroundSync(call: PluginCall) {
        SyncWorker.schedule(context, (call.getInt("intervalMinutes") ?: 15).toLong())
        call.resolve()
    }

    @PluginMethod
    fun cancelBackgroundSync(call: PluginCall) {
        SyncWorker.cancel(context)
        call.resolve()
    }

    companion object {
        /** The plugin instance while the app process is alive; SyncWorker reads it. */
        @Volatile var live: FandayCalendarPlugin? = null
    }
}
