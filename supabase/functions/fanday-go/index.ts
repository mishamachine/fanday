import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
import { parseGoPath, resolveTarget } from './target.ts'
import { clientKey, makeLimiter } from './ratelimit.ts'

// GET /functions/v1/fanday-go/{game}/{slot}  (slot: watch | tickets | sponsor)
// Calendar events carry this link instead of the partner URL, so partners can be swapped without rewriting events
// already on phones. Counts per game, slot and day (one upserted counter row, no row per click), never per person:
// nothing about the caller is stored. Over-limit callers are still redirected but not counted (see ratelimit.ts).
// Redirects only to a URL stored on the game row or its active sponsor row (target.ts): not an open redirect.
const allowCount = makeLimiter(30, 60_000) // 30 counted clicks per minute per caller, kept in memory only

// Keys: new-style (SUPABASE_SECRET_KEYS JSON, documented) first, legacy service role key as fallback.
function secretKey(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')?.default; if (k) return k } catch { /* fall through */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } })
  const parsed = parseGoPath(new URL(req.url).pathname)
  if (!parsed) return new Response('Not found', { status: 404 })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false }, db: { schema: 'fanday' } })
  const { data: row, error } = await admin.from('games')
    .select('watch_url, tickets_url, sponsor_url, sponsor:sponsors(url, starts_on, ends_on)').eq('id', parsed.gameId).maybeSingle()
  if (error) { console.error('go lookup', error.message); return new Response('Try again later', { status: 503 }) }
  const target = resolveTarget(row as never, parsed.slot)
  if (!target) return new Response('Not found', { status: 404 })

  const caller = clientKey(req.headers, Number(Deno.env.get('FANDAY_TRUSTED_PROXY_HOPS')) || 1) // platform-set, not the client's first XFF entry
  if (allowCount(caller)) {
    // Best effort: a failed count must never block the redirect.
    const { error: cErr } = await admin.rpc('record_link_click', { p_game: parsed.gameId, p_slot: parsed.slot })
    if (cErr) console.error('go count', cErr.message)
  }

  return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
})
