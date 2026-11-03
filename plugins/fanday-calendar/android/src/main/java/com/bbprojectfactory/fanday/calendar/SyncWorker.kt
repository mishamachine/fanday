package com.bbprojectfactory.fanday.calendar

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Periodic wake-up. The sync itself (Supabase fetch + diff + calendar writes) lives in TypeScript, so this worker can
 * only trigger it while the app process, and with it the Capacitor WebView, is still alive: it then fires `syncDue`.
 * If Android has already killed the process there is nothing to run, and the next app open or resume syncs instead.
 * Reaching a killed app needs a separate path (a silent FCM push, planned) or a native re-implementation of the sync.
 */
class SyncWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        FandayCalendarPlugin.live?.fireSyncDue()
        return Result.success()
    }

    companion object {
        private const val NAME = "fanday-calendar-sync"

        fun schedule(ctx: Context, minutes: Long) {
            val req = PeriodicWorkRequest.Builder(SyncWorker::class.java, maxOf(15L, minutes), TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, req)
        }

        fun cancel(ctx: Context) { WorkManager.getInstance(ctx).cancelUniqueWork(NAME) }
    }
}
