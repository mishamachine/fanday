// Pure helpers (no Capacitor or Supabase imports) so they can be unit-tested in Node.

/** The only redirects fanday-send-link accepts (its allow-list has the same two). */
export const EMAIL_REDIRECT_NATIVE = 'com.bbprojectfactory.fanday://auth/callback'
export const EMAIL_REDIRECT_WEB = 'https://fanday.bbprojectfactory.com/auth/callback'

export function authRedirect(native: boolean, scheme: string, origin: string): string {
  return native ? `${scheme}://auth/callback` : origin
}

export const emailRedirect = (native: boolean): string => (native ? EMAIL_REDIRECT_NATIVE : EMAIL_REDIRECT_WEB)

export interface CallbackParams { code?: string; error?: string; tokenHash?: string; otpType?: 'magiclink' | 'email' }

/** The deep link carries ?token_hash=...&type=magiclink (email link), ?code=... (Apple web OAuth, PKCE) or ?error=...; anything else is ignored. */
export function parseCallbackUrl(url: string, scheme: string): CallbackParams | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  const isApp = u.protocol === `${scheme}:` && u.host === 'auth' && u.pathname === '/callback'
  if (!isApp) return null
  const code = u.searchParams.get('code') ?? undefined
  const error = u.searchParams.get('error_description') ?? u.searchParams.get('error') ?? undefined
  const th = u.searchParams.get('token_hash')
  const ty = u.searchParams.get('type')
  const tokenHash = th && /^[A-Za-z0-9_-]{16,128}$/.test(th) && (ty === 'magiclink' || ty === 'email') ? th : undefined
  return code || error || tokenHash ? { code, error, tokenHash, otpType: tokenHash ? (ty as 'magiclink' | 'email') : undefined } : null
}

export function randomNonce(bytes = 16): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
