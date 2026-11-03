// Pure helpers for fanday-send-link (no Deno APIs, so scripts/test-send-link.mjs can import them).

/** The only places a link may send the user. Anything else is refused before any work is done. */
export const ALLOWED_REDIRECTS: readonly string[] = [
  'com.bbprojectfactory.fanday://auth/callback',
  'https://fanday.bbprojectfactory.com/auth/callback',
]

/** Lower-cased, trimmed address, or null if it is not a plausible single address. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const e = raw.trim().toLowerCase()
  if (e.length < 5 || e.length > 254 || /[\s,;<>"'\\]/.test(e)) return null
  return /^[^@]+@[^@]+\.[^@]+$/.test(e) ? e : null
}

/** The link in the email. The token_hash is spent only when the app calls verifyOtp, so a mail scanner opening the link cannot use it up. */
export function buildLink(redirect: string, hashedToken: string): string {
  const u = new URL(redirect)
  u.searchParams.set('token_hash', hashedToken)
  u.searchParams.set('type', 'magiclink')
  return u.toString()
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function renderEmail(template: string, link: string): { html: string; text: string } {
  return {
    html: template.split('{{ .ConfirmationURL }}').join(escapeHtml(link)),
    text: `Tap this link to sign in to Fanday (works once, for one hour):\n\n${link}\n\nIf you didn't ask to sign in, ignore this email.\n\nFanday · B&B Project Factory`,
  }
}

/** The one reply the function gives for every well-formed request, whatever happened behind it. */
export const GENERIC = { ok: true, message: 'If that address can sign in, a link is on its way. It can take a minute.' }
