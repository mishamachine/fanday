import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
import { allow, clientAddress, sha256Hex } from '../_shared/fanday-limits.ts'

// POST { action: 'register' } -> { token }   (verify_jwt false: signed-out phones have no session)
// Issues the device token that keys a signed-out user's follows. 32 random bytes from the platform CSPRNG, returned ONCE as 64 hex chars,
// kept by the app in secure storage. Only sha256(token) is stored (fanday.device_tokens). No IP is stored: the per-caller limit counts
// sha256(daily salt + address), and the salt is deleted after two days. Limits: 20 tokens per caller per hour (caller = sha256 of daily salt + address), 2000 per hour overall.
// Everything else the app does with the token is a direct RPC (fanday.device_*), including delete, so this is the only function it needs.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function fromDict(name: string): string | undefined {
  try { return JSON.parse(Deno.env.get(name) ?? '{}')?.default } catch { return undefined }
}
const secretKey = () => fromDict('SUPABASE_SECRET_KEYS') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const b = await req.json().catch(() => ({}))
  if (b.action !== 'register') return json({ error: 'Unknown action' }, 400)
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false }, db: { schema: 'fanday' } })
    const rpc = (fn: string, args: Record<string, unknown>) => db.rpc(fn, args)
    const addr = clientAddress(req.headers, Number(Deno.env.get('FANDAY_TRUSTED_PROXY_HOPS')) || 1)
    if (!(await allow(rpc, [{ scope: 'device-ip', value: addr, window: 'hour', max: 20 }, { scope: 'device-all', value: null, window: 'hour', max: 2000 }]))) {
      return json({ error: 'Too many requests. Try again later.' }, 429)
    }
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const token = Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('')
    const hash = await sha256Hex(token)
    const { error } = await db.rpc('register_device_token', { p_hash: `\\x${hash}` })
    if (error) { console.error('fanday-device', error.message); return json({ error: 'Try again later.' }, 503) }
    return json({ token })
  } catch (e) {
    console.error('fanday-device', e)
    return json({ error: 'Try again later.' }, 503)
  }
})
