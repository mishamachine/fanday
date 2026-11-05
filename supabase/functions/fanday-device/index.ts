import 'jsr:@supabase/functions-js@2.118.0/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0?pin=v140'
import { handle } from './handler.ts'

// fanday-device (verify_jwt = false). See handler.ts. Publishable key only; no service role.
function publishableKey(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}')?.default; if (k) return k } catch { /* fall through */ }
  return Deno.env.get('SUPABASE_ANON_KEY')!
}

Deno.serve((req) => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(), { auth: { persistSession: false }, db: { schema: 'fanday' } })
  return handle(req, {
    issue: (args) => db.rpc('issue_device_token', args),
    secret: Deno.env.get('FANDAY_DEVICE_SECRET'),
    hops: Number(Deno.env.get('FANDAY_TRUSTED_PROXY_HOPS')) || 1,
  })
})
