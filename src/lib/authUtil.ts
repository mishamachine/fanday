// Pure helpers (no Capacitor or Supabase imports) so they can be unit-tested in Node.
export function authRedirect(native: boolean, scheme: string, origin: string): string {
  return native ? `${scheme}://auth/callback` : origin
}

/** The deep link carries ?code=... (PKCE) or ?error=...; anything else is ignored. */
export function parseCallbackUrl(url: string, scheme: string): { code?: string; error?: string } | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  const isApp = u.protocol === `${scheme}:` && u.host === 'auth' && u.pathname === '/callback'
  if (!isApp) return null
  const code = u.searchParams.get('code') ?? undefined
  const error = u.searchParams.get('error_description') ?? u.searchParams.get('error') ?? undefined
  return code || error ? { code, error } : null
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
