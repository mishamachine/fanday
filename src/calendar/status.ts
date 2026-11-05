import type { SyncStats } from './sync.ts'

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'denied' | 'rationale' | 'partial' | 'error'

/** A pass is complete only when nothing failed. Partial passes keep what worked and are retried. */
export function statusFor(stats: SyncStats): { status: 'ok' | 'partial'; failed: number } {
  return stats.failed > 0 ? { status: 'partial', failed: stats.failed } : { status: 'ok', failed: 0 }
}

export function statusText(status: SyncStatus, failed = 0): string {
  switch (status) {
    case 'syncing': return 'Syncing your calendar…'
    case 'ok': return 'Calendar up to date'
    case 'partial': return `Couldn't add ${failed} ${failed === 1 ? 'game' : 'games'}, retrying`
    case 'error': return "Couldn't update your calendar, retrying"
    case 'denied': return 'Calendar access is off'
    default: return ''
  }
}

/** Retry only after a partial or failed pass, with growing delays, and give up after a few tries (the next open or resume tries again). */
export const RETRY_DELAYS_MS = [20_000, 60_000, 180_000]
export const retryDelay = (attempt: number): number | null => RETRY_DELAYS_MS[attempt] ?? null
