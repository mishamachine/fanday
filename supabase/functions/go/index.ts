import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
import { parseGoPath, resolveTarget } from './target.ts'

// GET /functions/v1/go/{game}/{slot}  (slot: watch | tickets | sponsor)
// Calendar events carry this link instead of the partner URL, so partners can be swapped without rewriting events
// already on phones. Counts one click per game and slot, never per person: nothing about the caller is stored.
// Redirects only to a URL stored on the game row (see target.ts), so it can't be used as an open redirect.
Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } })
  const parsed = parseGoPath(new URL(req.url).pathname)
  if (!parsed) return new Response('Not found', { status: 404 })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: row, error } = await admin.from('games')
    .select('watch_url, tickets_url, sponsor_url, sponsor:sponsors(url)').eq('id', parsed.gameId).maybeSingle()
  if (error) { console.error('go lookup', error.message); return new Response('Try again later', { status: 503 }) }
  const target = resolveTarget(row as never, parsed.slot)
  if (!target) return new Response('Not found', { status: 404 })

  // Best effort: a failed count must never block the redirect.
  const { error: cErr } = await admin.from('link_clicks').insert({ game_id: parsed.gameId, slot: parsed.slot })
  if (cErr) console.error('go count', cErr.message)

  return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
})
