import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
import { appleConfigFrom, revokeAppleAuthorization } from './apple.ts'

// POST { confirm: 'DELETE', apple_authorization_code?, apple_client_id? } with the user's bearer token.
// 1. Revoke the Sign in with Apple authorization when APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY secrets exist AND
//    the app sent a fresh authorization code (iOS re-confirms with Apple at delete time). Skipped cleanly otherwise.
// 2. Delete the auth user. Every user-owned row cascades (follows, devices, device_events, profiles, usage_events).
// The calendar on the phone is removed by the app. Anonymous users can delete too (they are real auth users).
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const BUNDLE_ID = 'com.bbprojectfactory.fanday'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const auth = req.headers.get('Authorization')
    if (!auth) return json({ error: 'Unauthorized' }, 401)
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } })
    const { data: { user }, error: authErr } = await anon.auth.getUser(auth.replace(/^Bearer /i, ''))
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const b = await req.json().catch(() => ({}))
    if (b.confirm !== 'DELETE') return json({ error: 'Send confirm: "DELETE".' }, 400)

    let appleRevoked: boolean | null = null // null = not attempted
    const cfg = appleConfigFrom((k) => Deno.env.get(k))
    const hasApple = (user.identities ?? []).some((i) => i.provider === 'apple')
    if (cfg && hasApple && typeof b.apple_authorization_code === 'string') {
      // Only our own bundle id or Services ID may be used as the client id.
      const allowed = [BUNDLE_ID, Deno.env.get('APPLE_SERVICES_ID')].filter(Boolean)
      const clientId = allowed.includes(b.apple_client_id) ? b.apple_client_id : BUNDLE_ID
      appleRevoked = await revokeAppleAuthorization(cfg, clientId, b.apple_authorization_code).catch((e) => { console.error('apple revoke', e); return false })
      if (!appleRevoked) console.error('apple revoke failed for user', user.id)
    }

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) { console.error('delete-account', error.message); return json({ error: 'Could not delete the account. Nothing was deleted; try again.' }, 500) }
    return json({ deleted: true, appleRevoked })
  } catch (e) {
    console.error('delete-account', e)
    return json({ error: 'Something went wrong. Nothing was deleted; try again.' }, 500)
  }
})
