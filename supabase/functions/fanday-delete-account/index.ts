import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
import { allowedRedirectUris, appleConfigFrom, appleGate, BAD_REDIRECT, REVOKE_FAILED, REVOKE_MISMATCH, revokeAppleAuthorization } from './apple.ts'
import { deleteAccount } from './delete.ts'

// POST { confirm: 'DELETE', apple_authorization_code?, apple_client_id?, apple_redirect_uri? } with the signed-in user's bearer token.
// (Signed-out users delete through the device token: fanday.device_delete, no function needed.)
// The project is SHARED with Woofabulary and Chess Tutor, so deleting the auth user is the exception, not the rule (delete.ts):
// 1. FAILS CLOSED for Apple users: if the account has an Apple identity, the Apple secrets (FANDAY_APPLE_TEAM_ID, FANDAY_APPLE_KEY_ID,
//    FANDAY_APPLE_PRIVATE_KEY) must exist, the app must send a fresh authorization code, and Apple must accept the revoke. Otherwise we
//    return an error and delete NOTHING.
// 2. Always delete every Fanday row of the user.
// 3. Delete the auth user ONLY IF fanday.user_origin.created_by_fanday is true AND the user has no rows in any table outside `fanday`.
//    Otherwise keep the auth user and unlink the Apple identity Fanday added.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const BUNDLE_ID = 'com.bbprojectfactory.fanday'

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
    const jwt = auth.replace(/^Bearer /i, '')
    const anon = createClient(url, publishableKey(), { auth: { persistSession: false } })
    const { data: { user }, error: authErr } = await anon.auth.getUser(jwt)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const b = await req.json().catch(() => ({}))
    if (b.confirm !== 'DELETE') return json({ error: 'Send confirm: "DELETE".' }, 400)

    let appleRevoked: boolean | null = null // null = user has no Apple identity, nothing to revoke
    const appleIdent = (user.identities ?? []).find((i) => i.provider === 'apple')
    const hasApple = !!appleIdent
    const cfg = appleConfigFrom((k) => Deno.env.get(k))
    const gate = appleGate(hasApple, cfg, b.apple_authorization_code)
    if (!gate.ok) { console.error('fanday-delete-account refused:', gate.code); return json({ code: gate.code, error: gate.error }, gate.status) }
    if (hasApple && cfg) {
      // Only our own bundle id or Services ID may be used as the client id.
      const allowed = [BUNDLE_ID, Deno.env.get('FANDAY_APPLE_SERVICES_ID')].filter(Boolean)
      const clientId = allowed.includes(b.apple_client_id) ? b.apple_client_id : BUNDLE_ID
      let redirectUri: string | undefined
      if (clientId !== BUNDLE_ID) {
        if (typeof b.apple_redirect_uri !== 'string' || !allowedRedirectUris((k) => Deno.env.get(k)).includes(b.apple_redirect_uri)) {
          return json({ code: BAD_REDIRECT.code, error: BAD_REDIRECT.error }, BAD_REDIRECT.status)
        }
        redirectUri = b.apple_redirect_uri
      }
      const expectedSub = String((appleIdent?.identity_data as { sub?: string } | undefined)?.sub ?? appleIdent?.id ?? '')
      const res = await revokeAppleAuthorization(cfg, clientId, b.apple_authorization_code, { redirectUri, expectedSub }).catch((e) => { console.error('apple revoke', e); return 'failed' as const })
      appleRevoked = res === 'revoked'
      if (res === 'mismatch') { console.error('fanday-delete-account: Apple sub mismatch for user', user.id); return json({ code: REVOKE_MISMATCH.code, error: REVOKE_MISMATCH.error }, REVOKE_MISMATCH.status) }
      if (!appleRevoked) { console.error('fanday-delete-account: Apple revoke failed for user', user.id); return json({ code: REVOKE_FAILED.code, error: REVOKE_FAILED.error }, REVOKE_FAILED.status) }
    }

    const admin = createClient(url, secretKey(), { auth: { persistSession: false }, db: { schema: 'fanday' } })
    const result = await deleteAccount(user.id, {
      rpc: (fn, args) => admin.rpc(fn, args),
      deleteAuthUser: async (id) => { const { error } = await admin.auth.admin.deleteUser(id); return error ? error.message : null },
      // Unlink uses the user's OWN token (DELETE /auth/v1/user/identities/{id}); the server refuses to remove a user's last identity.
      unlinkIdentity: async (identityId) => {
        const r = await fetch(`${url}/auth/v1/user/identities/${encodeURIComponent(identityId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${jwt}`, apikey: publishableKey() } })
        return r.ok
      },
    }, { appleIdentityId: appleIdent?.identity_id ?? appleIdent?.id ?? null })
    if (!result.ok) {
      console.error('fanday-delete-account', result.stage, result.error)
      // 'rows': nothing was deleted. 'auth': your Fanday data is already gone but the sign-in account is still there; retrying finishes it.
      return json({ error: result.stage === 'rows'
        ? 'Could not delete the account. Nothing was deleted; try again.'
        : 'Your Fanday data was deleted, but we could not finish closing the account. Please try again.' }, 500)
    }
    return json({ deleted: true, authUserDeleted: result.authUserDeleted, appleRevoked, appleUnlinked: result.appleUnlinked })
  } catch (e) {
    console.error('fanday-delete-account', e)
    return json({ error: 'Something went wrong. Nothing was deleted; try again.' }, 500)
  }
})
