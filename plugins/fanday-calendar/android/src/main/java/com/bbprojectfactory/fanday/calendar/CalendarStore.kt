package com.bbprojectfactory.fanday.calendar

import android.content.ContentResolver
import android.content.ContentUris
import android.content.ContentValues
import android.net.Uri
import android.provider.CalendarContract
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Reminders
import android.graphics.Color
import java.util.Calendar
import java.util.TimeZone

/** One event as the JS layer sends it. Instants are epoch ms; all-day events carry a "YYYY-MM-DD" date. */
data class EventData(
    val title: String,
    val location: String?,
    val notes: String,
    val startMs: Long,
    val endMs: Long,
    val allDay: Boolean,
    val allDayDate: String?,
    val alarmMinutesBefore: Int?,
)

data class StoredRow(
    val id: Long,
    val calendarId: Long,
    val title: String,
    val location: String?,
    val notes: String,
    val startMs: Long,
    val endMs: Long,
    val allDay: Boolean,
    val alarmMinutesBefore: Int?,
)

/**
 * CalendarContract access for the app's own LOCAL calendar. Every write goes through the sync-adapter URI form for
 * (account "Fanday", type ACCOUNT_TYPE_LOCAL): that is how an app owns a local calendar, and it makes deletes real
 * (without it the provider only flags rows as DELETED for a sync adapter that never comes).
 */
class CalendarStore(private val cr: ContentResolver) {
    private fun asSyncAdapter(uri: Uri): Uri = uri.buildUpon()
        .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
        .appendQueryParameter(Calendars.ACCOUNT_NAME, ACCOUNT)
        .appendQueryParameter(Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
        .build()

    fun ensureCalendar(title: String, colorHex: String?): Long {
        cr.query(
            Calendars.CONTENT_URI, arrayOf(Calendars._ID),
            "${Calendars.ACCOUNT_NAME}=? AND ${Calendars.ACCOUNT_TYPE}=?", arrayOf(ACCOUNT, CalendarContract.ACCOUNT_TYPE_LOCAL), null,
        )?.use { if (it.moveToFirst()) return it.getLong(0) }

        val v = ContentValues().apply {
            put(Calendars.ACCOUNT_NAME, ACCOUNT)
            put(Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
            put(Calendars.NAME, title)
            put(Calendars.CALENDAR_DISPLAY_NAME, title)
            put(Calendars.CALENDAR_COLOR, parseColor(colorHex))
            put(Calendars.CALENDAR_ACCESS_LEVEL, Calendars.CAL_ACCESS_OWNER)
            put(Calendars.OWNER_ACCOUNT, ACCOUNT)
            put(Calendars.VISIBLE, 1)
            put(Calendars.SYNC_EVENTS, 1)
            put(Calendars.CALENDAR_TIME_ZONE, TimeZone.getDefault().id)
        }
        val uri = cr.insert(asSyncAdapter(Calendars.CONTENT_URI), v) ?: error("Could not create the Fanday calendar")
        return ContentUris.parseId(uri)
    }

    fun calendarExists(id: Long): Boolean =
        cr.query(ContentUris.withAppendedId(Calendars.CONTENT_URI, id), arrayOf(Calendars._ID), null, null, null)?.use { it.moveToFirst() } ?: false

    fun deleteCalendar(id: Long) {
        cr.delete(asSyncAdapter(ContentUris.withAppendedId(Calendars.CONTENT_URI, id)), null, null)
    }

    /** Update the event when [existing] is still one of this calendar's events, otherwise insert. Returns the _ID. */
    fun upsert(calendarId: Long, e: EventData, existing: Long?): Long {
        val v = toValues(calendarId, e)
        if (existing != null && ownedBy(calendarId, existing)) {
            cr.update(asSyncAdapter(ContentUris.withAppendedId(Events.CONTENT_URI, existing)), v, null, null)
            writeReminder(existing, e.alarmMinutesBefore)
            return existing
        }
        val uri = cr.insert(asSyncAdapter(Events.CONTENT_URI), v) ?: error("Could not insert the event")
        val id = ContentUris.parseId(uri)
        writeReminder(id, e.alarmMinutesBefore)
        return id
    }

    fun delete(id: Long) {
        cr.delete(asSyncAdapter(ContentUris.withAppendedId(Events.CONTENT_URI, id)), null, null)
    }

    fun list(calendarId: Long, ids: List<Long>): List<StoredRow> {
        val out = ArrayList<StoredRow>()
        for (id in ids) {
            cr.query(
                Events.CONTENT_URI,
                arrayOf(Events._ID, Events.CALENDAR_ID, Events.TITLE, Events.EVENT_LOCATION, Events.DESCRIPTION, Events.DTSTART, Events.DTEND, Events.ALL_DAY),
                "${Events._ID}=? AND ${Events.CALENDAR_ID}=? AND ${Events.DELETED}=0", arrayOf(id.toString(), calendarId.toString()), null,
            )?.use { c ->
                if (c.moveToFirst()) {
                    out.add(StoredRow(
                        c.getLong(0), c.getLong(1), c.getString(2) ?: "", c.getString(3), c.getString(4) ?: "",
                        c.getLong(5), if (c.isNull(6)) c.getLong(5) else c.getLong(6), c.getInt(7) == 1, firstReminder(id),
                    ))
                }
            }
        }
        return out
    }

    private fun ownedBy(calendarId: Long, id: Long): Boolean =
        cr.query(
            Events.CONTENT_URI, arrayOf(Events._ID),
            "${Events._ID}=? AND ${Events.CALENDAR_ID}=? AND ${Events.DELETED}=0", arrayOf(id.toString(), calendarId.toString()), null,
        )?.use { it.moveToFirst() } ?: false

    private fun toValues(calendarId: Long, e: EventData) = ContentValues().apply {
        put(Events.CALENDAR_ID, calendarId)
        put(Events.TITLE, e.title)
        put(Events.EVENT_LOCATION, e.location)
        put(Events.DESCRIPTION, e.notes)
        if (e.allDay) {
            // All-day rows must be UTC midnight with an exclusive end one day later and EVENT_TIMEZONE = UTC, or the
            // provider shifts them by the phone's offset. The date is the game date as written, not converted.
            val start = utcMidnight(e.allDayDate ?: error("allDayDate is required for all-day events"))
            put(Events.ALL_DAY, 1)
            put(Events.DTSTART, start)
            put(Events.DTEND, start + DAY_MS)
            put(Events.EVENT_TIMEZONE, "UTC")
        } else {
            put(Events.ALL_DAY, 0)
            put(Events.DTSTART, e.startMs)
            put(Events.DTEND, e.endMs)
            put(Events.EVENT_TIMEZONE, TimeZone.getDefault().id)
        }
        put(Events.HAS_ALARM, if (!e.allDay && e.alarmMinutesBefore != null) 1 else 0)
    }

    private fun writeReminder(eventId: Long, minutes: Int?) {
        cr.delete(Reminders.CONTENT_URI, "${Reminders.EVENT_ID}=?", arrayOf(eventId.toString()))
        if (minutes == null) return
        val v = ContentValues().apply {
            put(Reminders.EVENT_ID, eventId)
            put(Reminders.MINUTES, minutes)
            put(Reminders.METHOD, Reminders.METHOD_ALERT)
        }
        cr.insert(Reminders.CONTENT_URI, v)
    }

    private fun firstReminder(eventId: Long): Int? =
        cr.query(Reminders.CONTENT_URI, arrayOf(Reminders.MINUTES), "${Reminders.EVENT_ID}=?", arrayOf(eventId.toString()), null)
            ?.use { if (it.moveToFirst()) it.getInt(0) else null }

    private fun utcMidnight(ymd: String): Long {
        val p = ymd.take(10).split("-").map { it.toInt() }
        require(p.size == 3) { "Bad date: $ymd" }
        val c = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
        c.clear()
        c.set(p[0], p[1] - 1, p[2], 0, 0, 0)
        return c.timeInMillis
    }

    private fun parseColor(hex: String?): Int = try { Color.parseColor(hex ?: "#0F5E5A") } catch (_: IllegalArgumentException) { Color.parseColor("#0F5E5A") }

    companion object {
        const val ACCOUNT = "Fanday"
        private const val DAY_MS = 24L * 60 * 60 * 1000
    }
}
