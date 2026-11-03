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

/** Exchange the one-time authorization code for a refresh token, then revoke it. Returns true when Apple accepted the revoke. */
export async function revokeAppleAuthorization(cfg: AppleConfig, clientId: string, authorizationCode: string, f: Fetch = fetch): Promise<boolean> {
  const secret = await appleClientSecret(cfg, clientId)
  const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) })
  const tok = await f('https://appleid.apple.com/auth/token', form({ client_id: clientId, client_secret: secret, code: authorizationCode, grant_type: 'authorization_code' }))
  if (!tok.ok) return false
  const { refresh_token } = await tok.json().catch(() => ({}))
  if (!refresh_token) return false
  const rev = await f('https://appleid.apple.com/auth/revoke', form({ client_id: clientId, client_secret: secret, token: refresh_token, token_type_hint: 'refresh_token' }))
  return rev.ok
}
