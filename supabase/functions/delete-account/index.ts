import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
import { appleConfigFrom, appleGate, REVOKE_FAILED, revokeAppleAuthorization } from './apple.ts'

// POST { confirm: 'DELETE', apple_authorization_code?, apple_client_id? } with the user's bearer token.
// 1. FAILS CLOSED for Apple users: if the account has an Apple identity, the Apple secrets (APPLE_TEAM_ID, APPLE_KEY_ID,
//    APPLE_PRIVATE_KEY) must exist, the app must send a fresh authorization code (iOS: native sheet; web/Android: Sign in
//    with Apple JS popup, client id = Services ID), and Apple must accept the revoke. Otherwise we return an error and
//    delete NOTHING, so the user can retry; we never leave an Apple grant behind silently.
// 2. Delete the auth user. Every user-owned row cascades (follows, devices, device_events, profiles, usage_events).
// The calendar on the phone is removed by the app. Anonymous users can delete too (they are real auth users).
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const BUNDLE_ID = 'com.bbprojectfactory.fanday'

// Keys: the documented new-style env vars (JSON dictionaries, key name 'default') first, legacy names as fallback.
function fromDict(name: string): string | undefined {
  try { return JSON.parse(Deno.env.get(name) ?? '{}')?.default } catch { return undefined }
}
const publishableKey = () => fromDict('SUPABASE_PUBLISHABLE_KEYS') ?? Deno.env.get('SUPABASE_ANON_KEY')!
const secretKey = () => fromDict('SUPABASE_SECRET_KEYS') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const auth = req.headers.get('Authorization')
    if (!auth) return json({ error: 'Unauthorized' }, 401)
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = createClient(url, publishableKey(), { auth: { persistSession: false } })
    const { data: { user }, error: authErr } = await anon.auth.getUser(auth.replace(/^Bearer /i, ''))
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const b = await req.json().catch(() => ({}))
    if (b.confirm !== 'DELETE') return json({ error: 'Send confirm: "DELETE".' }, 400)

    let appleRevoked: boolean | null = null // null = user has no Apple identity, nothing to revoke
    const hasApple = (user.identities ?? []).some((i) => i.provider === 'apple')
    const cfg = appleConfigFrom((k) => Deno.env.get(k))
    const gate = appleGate(hasApple, cfg, b.apple_authorization_code)
    if (!gate.ok) { console.error('delete-account refused:', gate.code); return json({ code: gate.code, error: gate.error }, gate.status) }
    if (hasApple && cfg) {
      // Only our own bundle id or Services ID may be used as the client id.
      const allowed = [BUNDLE_ID, Deno.env.get('APPLE_SERVICES_ID')].filter(Boolean)
      const clientId = allowed.includes(b.apple_client_id) ? b.apple_client_id : BUNDLE_ID
      appleRevoked = await revokeAppleAuthorization(cfg, clientId, b.apple_authorization_code).catch((e) => { console.error('apple revoke', e); return false })
      if (!appleRevoked) { console.error('delete-account: Apple revoke failed for user', user.id); return json({ code: REVOKE_FAILED.code, error: REVOKE_FAILED.error }, REVOKE_FAILED.status) }
    }

    const admin = createClient(url, secretKey(), { auth: { persistSession: false } })
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) { console.error('delete-account', error.message); return json({ error: 'Could not delete the account. Nothing was deleted; try again.' }, 500) }
    return json({ deleted: true, appleRevoked })
  } catch (e) {
    console.error('delete-account', e)
    return json({ error: 'Something went wrong. Nothing was deleted; try again.' }, 500)
  }
})
