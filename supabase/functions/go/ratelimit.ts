// In-memory, per-isolate request limiter for the `go` function. The caller key (an IP address) lives only in this
// Map, only for the window, and is never written to the database or logs. Isolates are ephemeral and several may run,
// so this is a best-effort brake on counter inflation, not a hard guarantee.
export function makeLimiter(max: number, windowMs: number, maxKeys = 5000) {
  const hits = new Map<string, { n: number; reset: number }>()
  return (key: string, now = Date.now()): boolean => {
    if (hits.size > maxKeys) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k)
    if (hits.size > maxKeys) hits.clear()
    const h = hits.get(key)
    if (!h || h.reset <= now) { hits.set(key, { n: 1, reset: now + windowMs }); return true }
    h.n++
    return h.n <= max
  }
}

/**
 * Rate-limit key from request headers. The FIRST x-forwarded-for entry is whatever the client sent, so it is never used.
 * Order: cf-connecting-ip (set by the platform's Cloudflare edge, which overwrites client values), else the entry the
 * trusted proxy chain appended: `hops` from the right (default 1 = the last entry). Hosted Supabase's exact header
 * behaviour is not documented [unverified]; set TRUSTED_PROXY_HOPS if more than one proxy appends. With no usable
 * header all callers share one 'unknown' bucket, which only means fewer counted clicks, never a blocked redirect.
 */
export function clientKey(h: { get(name: string): string | null }, hops = 1): string {
  const cf = h.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const parts = (h.get('x-forwarded-for') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  return parts[parts.length - Math.max(1, hops)] ?? 'unknown'
}
