import { clientAddress } from '../_shared/fanday-limits.ts'

// POST { action: 'register' } -> { token }   (verify_jwt false: signed-out phones have no session)
// Issues the device token that keys a signed-out user's follows: 32 random bytes from the platform CSPRNG, returned ONCE as 64 hex chars,
// kept by the app in secure storage. Only sha256(token) is stored (fanday.device_tokens).
// NO service-role key: the function calls fanday.issue_device_token with the publishable key and FANDAY_DEVICE_SECRET, which the RPC checks
// against a hash in fanday.function_secrets. The RPC hashes the caller's address with the daily salt and only counts it:
// 20 tokens per caller per hour, 2000 per hour overall. Everything else the app does with the token is a direct RPC (fanday.device_*).
export interface Deps {
  issue(args: { p_secret: string; p_addr: string; p_hash: string }): Promise<{ error: { message: string } | null }>
  secret: string | undefined
  hops?: number
}
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

export async function handle(req: Request, d: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const b = await req.json().catch(() => ({}))
  if (b.action !== 'register') return json({ error: 'Unknown action' }, 400)
  if (!d.secret) { console.error('fanday-device: FANDAY_DEVICE_SECRET is not set'); return json({ error: 'Try again later.' }, 503) }
  const token = hex(crypto.getRandomValues(new Uint8Array(32)))
  const hash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))
  const { error } = await d.issue({ p_secret: d.secret, p_addr: clientAddress(req.headers, d.hops ?? 1), p_hash: `\\x${hash}` })
  if (error) {
    if (/rate_limited/.test(error.message)) return json({ error: 'Too many requests. Try again later.' }, 429)
    console.error('fanday-device', error.message)
    return json({ error: 'Try again later.' }, 503)
  }
  return json({ token })
}
