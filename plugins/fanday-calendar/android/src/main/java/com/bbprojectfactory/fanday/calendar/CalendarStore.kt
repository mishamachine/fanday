package com.bbprojectfactory.fanday.calendar

import android.content.ContentResolver
import android.content.ContentUris
import android.content.ContentValues
import android.content.SharedPreferences
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
 * CalendarContract access for the app's own LOCAL calendar. Safety rule: JS never names a calendar or an account. Every
 * query, insert, update and delete is scoped to account "Fanday" + ACCOUNT_TYPE_LOCAL + the calendar id stored natively
 * in [prefs], and by-id writes are `_ID=? AND CALENDAR_ID=?`. The sync-adapter URI form is used only for that account:
 * it is how an app owns a local calendar, and it makes deletes real instead of DELETED flags.
 */
class CalendarStore(private val cr: ContentResolver, private val prefs: SharedPreferences) {
    private fun asSyncAdapter(uri: Uri): Uri = uri.buildUpon()
        .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
        .appendQueryParameter(Calendars.ACCOUNT_NAME, ACCOUNT)
        .appendQueryParameter(Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
        .build()

    private val localType = CalendarContract.ACCOUNT_TYPE_LOCAL
    private fun inCal(id: Long) = "${Events.CALENDAR_ID}=? AND ${Events.ACCOUNT_NAME}=? AND ${Events.ACCOUNT_TYPE}=?" to arrayOf(id.toString(), ACCOUNT, localType)

    /** Our calendar's id, verified to still exist in our account; null if it does not. */
    fun ourId(): Long? {
        val stored = prefs.getLong(KEY, -1L)
        if (stored >= 0 && cr.query(
                Calendars.CONTENT_URI, arrayOf(Calendars._ID),
                "${Calendars._ID}=? AND ${Calendars.ACCOUNT_NAME}=? AND ${Calendars.ACCOUNT_TYPE}=?", arrayOf(stored.toString(), ACCOUNT, localType), null,
            )?.use { it.moveToFirst() } == true
        ) return stored
        // Stored id lost: our account is ours alone, so a calendar in it can be re-adopted.
        cr.query(
            Calendars.CONTENT_URI, arrayOf(Calendars._ID),
            "${Calendars.ACCOUNT_NAME}=? AND ${Calendars.ACCOUNT_TYPE}=?", arrayOf(ACCOUNT, localType), null,
        )?.use { if (it.moveToFirst()) { val id = it.getLong(0); prefs.edit().putLong(KEY, id).apply(); return id } }
        return null
    }

    fun ensureCalendar(title: String, colorHex: String?): Long {
        ourId()?.let { return it }
        val v = ContentValues().apply {
            put(Calendars.ACCOUNT_NAME, ACCOUNT)
            put(Calendars.ACCOUNT_TYPE, localType)
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
        val id = ContentUris.parseId(uri)
        prefs.edit().putLong(KEY, id).apply()
        return id
    }

    fun deleteCalendar() {
        val id = ourId() ?: return
        cr.delete(asSyncAdapter(Calendars.CONTENT_URI), "${Calendars._ID}=? AND ${Calendars.ACCOUNT_NAME}=? AND ${Calendars.ACCOUNT_TYPE}=?", arrayOf(id.toString(), ACCOUNT, localType))
        prefs.edit().remove(KEY).apply()
    }

    /** Update the event when [existing] is one of OUR events, otherwise insert. Returns the _ID. */
    fun upsert(e: EventData, existing: Long?): Long {
        val cal = ourId() ?: error("No Fanday calendar")
        val v = toValues(cal, e)
        if (existing != null && ownedBy(cal, existing)) {
            val n = cr.update(asSyncAdapter(Events.CONTENT_URI), v, "${Events._ID}=? AND ${Events.CALENDAR_ID}=?", arrayOf(existing.toString(), cal.toString()))
            if (n > 0) { writeReminder(existing, e.alarmMinutesBefore); return existing }
        }
        val uri = cr.insert(asSyncAdapter(Events.CONTENT_URI), v) ?: error("Could not insert the event")
        val id = ContentUris.parseId(uri)
        writeReminder(id, e.alarmMinutesBefore)
        return id
    }

    /** Deletes the event only if it is in our calendar; anything else is left alone. */
    fun delete(id: Long) {
        val cal = ourId() ?: return
        cr.delete(asSyncAdapter(Events.CONTENT_URI), "${Events._ID}=? AND ${Events.CALENDAR_ID}=?", arrayOf(id.toString(), cal.toString()))
    }

    fun list(ids: List<Long>): List<StoredRow> {
        val cal = ourId() ?: return emptyList()
        val (scope, args) = inCal(cal)
        val out = ArrayList<StoredRow>()
        for (id in ids) {
            cr.query(
                Events.CONTENT_URI,
                arrayOf(Events._ID, Events.CALENDAR_ID, Events.TITLE, Events.EVENT_LOCATION, Events.DESCRIPTION, Events.DTSTART, Events.DTEND, Events.ALL_DAY),
                "${Events._ID}=? AND $scope AND ${Events.DELETED}=0", arrayOf(id.toString(), *args), null,
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

    /** Delete every event in OUR calendar whose _ID is not in [keep] (duplicates, strays). */
    fun removeOrphans(keep: Set<Long>): Int {
        val cal = ourId() ?: return 0
        val (scope, args) = inCal(cal)
        val stray = ArrayList<Long>()
        cr.query(Events.CONTENT_URI, arrayOf(Events._ID), "$scope AND ${Events.DELETED}=0", args, null)?.use {
            while (it.moveToNext()) if (it.getLong(0) !in keep) stray.add(it.getLong(0))
        }
        stray.forEach { delete(it) }
        return stray.size
    }

    private fun ownedBy(cal: Long, id: Long): Boolean {
        val (scope, args) = inCal(cal)
        return cr.query(Events.CONTENT_URI, arrayOf(Events._ID), "${Events._ID}=? AND $scope AND ${Events.DELETED}=0", arrayOf(id.toString(), *args), null)
            ?.use { it.moveToFirst() } ?: false
    }

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
        private const val KEY = "calendar_id"
        private const val DAY_MS = 24L * 60 * 60 * 1000
    }
}
