// Abuse limits for fanday-device and fanday-send-link. Pure helpers plus one function that talks to the database through an injected
// `rpc`, so scripts/test-fanday-limits.mjs can run it without Deno. Nothing identifying is stored: callers are keyed by
// sha256(daily salt + value); the salt lives in fanday.rl_salts for two days; the database only keeps counters (fanday.rate_counters).

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Start of the UTC hour / day as an ISO string: the counter window. */
export const hourWindow = (now: Date): string => { const d = new Date(now); d.setUTCMinutes(0, 0, 0); return d.toISOString() }
export const dayWindow = (now: Date): string => { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d.toISOString() }

/** Caller address from headers: the platform-set value, never the client-supplied first X-Forwarded-For entry (same rule as fanday-go). */
export function clientAddress(h: { get(name: string): string | null }, hops = 1): string {
  const cf = h.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const parts = (h.get('x-forwarded-for') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  return parts[parts.length - Math.max(1, hops)] ?? 'unknown'
}

export interface Limit { scope: string; value: string | null; window: 'hour' | 'day'; max: number }

/**
 * Counts the limits IN ORDER and stops at the first one that is exceeded, so a later (global) limit is only consumed by callers that
 * passed the earlier (per-caller) ones. Returns null when every limit allows the call, else the scope of the limit that tripped
 * (a database error returns 'error': fails closed). `value` is hashed with the daily salt before it leaves this function; null = one shared bucket.
 */
export async function firstTripped(rpc: Rpc, limits: Limit[], now = new Date()): Promise<string | null> {
  const s = await rpc('rl_salt', {})
  if (s.error || typeof s.data !== 'string') return 'error'
  for (const l of limits) {
    const key = l.value === null ? 'all' : await sha256Hex(`${s.data}:${l.scope}:${l.value}`)
    const r = await rpc('rl_hit', { p_scope: l.scope, p_key: key, p_window: l.window === 'hour' ? hourWindow(now) : dayWindow(now), p_limit: l.max })
    if (r.error) return 'error'
    if (r.data !== true) return l.scope
  }
  return null
}

/** True when every limit allows the call. */
export async function allow(rpc: Rpc, limits: Limit[], now = new Date()): Promise<boolean> {
  return (await firstTripped(rpc, limits, now)) === null
}
