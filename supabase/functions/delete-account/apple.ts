// Sign in with Apple token revocation (Apple guideline 5.1.1(v)). Pure functions so scripts/test-apple.mjs can run them.
// Apple REST: POST appleid.apple.com/auth/token (code -> refresh token), then /auth/revoke. Shape written from memory, not yet run against a real key [unverified].
const enc = new TextEncoder()
const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === 'string' ? enc.encode(b) : new Uint8Array(b)
  let s = ''
  for (const x of bytes) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface AppleConfig { teamId: string; keyId: string; privateKey: string }

export function appleConfigFrom(env: (k: string) => string | undefined): AppleConfig | null {
  const teamId = env('APPLE_TEAM_ID')?.trim(), keyId = env('APPLE_KEY_ID')?.trim()
  const privateKey = env('APPLE_PRIVATE_KEY')?.replace(/\\n/g, '\n').trim()
  return teamId && keyId && privateKey ? { teamId, keyId, privateKey } : null
}

/** ES256 client secret JWT: iss = Team ID, sub = client id (bundle id or Services ID), aud = Apple. */
export async function appleClientSecret(cfg: AppleConfig, clientId: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const pem = cfg.privateKey.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: cfg.keyId, typ: 'JWT' }))
  const body = b64url(JSON.stringify({ iss: cfg.teamId, iat: nowSec, exp: nowSec + 300, aud: 'https://appleid.apple.com', sub: clientId }))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`))
  return `${head}.${body}.${b64url(sig)}` // WebCrypto returns raw r||s, which is what JWS ES256 wants
}

export type Fetch = typeof fetch
export type RevokeResult = 'revoked' | 'failed' | 'mismatch'

const jwtPayload = (jwt: string): Record<string, unknown> | null => {
  try {
    const p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p.padEnd(Math.ceil(p.length / 4) * 4, '=')), (c) => c.charCodeAt(0))))
  } catch { return null }
}

export interface RevokeOpts {
  /** Required for codes from the web/JS flow (client id = Services ID): must equal the redirect_uri the client used. */
  redirectUri?: string
  /** The user's Apple identity id (Supabase identity_data.sub). The id_token's sub must match before anything is revoked. */
  expectedSub: string
}

/**
 * Exchange the one-time authorization code for tokens, check the id_token belongs to THIS user, then revoke.
 * 'mismatch' = the code was for a different Apple account (nothing revoked); 'failed' = Apple refused or was unreachable.
 * The id_token comes straight from Apple over TLS in this response, so its signature is not re-verified here.
 */
export async function revokeAppleAuthorization(cfg: AppleConfig, clientId: string, authorizationCode: string, opts: RevokeOpts, f: Fetch = fetch): Promise<RevokeResult> {
  const secret = await appleClientSecret(cfg, clientId)
  const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) })
  const exchange: Record<string, string> = { client_id: clientId, client_secret: secret, code: authorizationCode, grant_type: 'authorization_code' }
  if (opts.redirectUri) exchange.redirect_uri = opts.redirectUri
  const tok = await f('https://appleid.apple.com/auth/token', form(exchange))
  if (!tok.ok) return 'failed'
  const { refresh_token, id_token } = await tok.json().catch(() => ({}))
  if (!refresh_token || !id_token) return 'failed'
  const sub = jwtPayload(id_token)?.sub
  if (typeof sub !== 'string' || !opts.expectedSub || sub !== opts.expectedSub) return 'mismatch'
  const rev = await f('https://appleid.apple.com/auth/revoke', form({ client_id: clientId, client_secret: secret, token: refresh_token, token_type_hint: 'refresh_token' }))
  return rev.ok ? 'revoked' : 'failed'
}

/** Redirect URIs the server accepts from the web flow: APPLE_REDIRECT_URIS (comma list) or the project's Supabase auth callback. */
export function allowedRedirectUris(env: (k: string) => string | undefined): string[] {
  const list = (env('APPLE_REDIRECT_URIS') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  const url = env('SUPABASE_URL')?.replace(/\/$/, '')
  return list.length ? list : url ? [`${url}/auth/v1/callback`] : []
}

export type Gate = { ok: true } | { ok: false; status: number; code: string; error: string }

/** Fail-closed gate for Apple users, run BEFORE anything is deleted. Non-Apple users always pass. */
export function appleGate(hasApple: boolean, cfg: AppleConfig | null, authorizationCode: unknown): Gate {
  if (!hasApple) return { ok: true }
  if (!cfg) return { ok: false, status: 503, code: 'apple_not_configured', error: 'Account deletion for Apple sign-in is not available right now. Nothing was deleted. Please try again later.' }
  if (typeof authorizationCode !== 'string' || !authorizationCode) return { ok: false, status: 409, code: 'apple_code_required', error: 'Please confirm with Apple to delete this account. Nothing was deleted.' }
  return { ok: true }
}
export const REVOKE_FAILED: Gate = { ok: false, status: 502, code: 'apple_revoke_failed', error: 'Apple did not confirm the removal. Nothing was deleted. Please try again.' }
export const REVOKE_MISMATCH: Gate = { ok: false, status: 403, code: 'apple_identity_mismatch', error: 'That Apple account is not the one linked to this account. Nothing was deleted.' }
export const BAD_REDIRECT: Gate = { ok: false, status: 400, code: 'apple_redirect_not_allowed', error: 'Apple confirmation could not be verified. Nothing was deleted.' }
