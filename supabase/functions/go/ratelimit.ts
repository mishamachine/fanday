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
