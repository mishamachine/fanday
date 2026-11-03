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
    private val store by lazy { CalendarStore(context.contentResolver, context.getSharedPreferences("fanday_calendar", android.content.Context.MODE_PRIVATE)) }

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

    // No method takes a calendar id: the store resolves its own calendar. Event ids come from JS but are only ever
    // matched inside that calendar.
    private fun id(call: PluginCall, key: String): Long? = call.getString(key)?.toLongOrNull()

    @PluginMethod
    fun createCalendar(call: PluginCall) = guarded(call) {
        val calId = store.ensureCalendar(call.getString("title") ?: "Fanday", call.getString("colorHex"))
        call.resolve(JSObject().put("calendarId", calId.toString()))
    }

    @PluginMethod
    fun deleteCalendar(call: PluginCall) = guarded(call) {
        store.deleteCalendar()
        call.resolve()
    }

    @PluginMethod
    fun upsertEvent(call: PluginCall) = guarded(call) {
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
        val eventId = store.upsert(data, id(call, "existingIdentifier"))
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
        val ids = (call.getArray("eventIdentifiers") ?: JSArray()).toList<String>().mapNotNull { it.toLongOrNull() }
        val events = JSArray()
        for (r in store.list(ids)) {
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
    fun removeOrphans(call: PluginCall) = guarded(call) {
        val keep = (call.getArray("keep") ?: JSArray()).toList<String>().mapNotNull { it.toLongOrNull() }.toSet()
        call.resolve(JSObject().put("removed", store.removeOrphans(keep, call.getDouble("fromMs")?.toLong())))
    }
}
