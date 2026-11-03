import { clientAddress, firstTripped, hourWindow, type Rpc } from '../_shared/fanday-limits.ts'
import { ALLOWED_REDIRECTS, buildLink, GENERIC, normalizeEmail, renderEmail } from './link.ts'

// POST { email, redirect } -> always { ok: true, message } (HTTP 200) for a well-formed request, so it cannot be used to find out
// which addresses have an account: not by the body, the status, nor (because the work runs after the reply) the timing.
// Refused up front, before any work: a redirect that is not in ALLOWED_REDIRECTS (400) or a body that is not JSON (400).
// Limits (counters only, nothing identifying stored): 10/hour per caller, 3/hour per address, 20/hour overall (Gmail stays far below its caps).
// When the overall cap trips, ONE alert email per hour goes to ALERT_TO through the same Gmail path (deduped in fanday.alert_log); it names no address.
// Link: Auth admin generateLink type 'magiclink'. A missing user is created by us first, and recorded in fanday.user_origin
// (created_by_fanday = true) via set_user_origin; fanday-delete-account relies on that table. Nothing is written to auth app_metadata.

export const ALERT_TO = 'machinemisha+fanday@gmail.com'

export interface Deps {
  rpc: Rpc
  createUser(email: string): Promise<string | null>        // admin.createUser({ email, email_confirm: true }) -> new user id (null if it already existed)
  generateLink(email: string): Promise<string | null>      // admin.generateLink({ type: 'magiclink', email }) -> properties.hashed_token
  send(msg: { to: string; subject: string; html: string; text: string }): Promise<void>
  template: { subject: string; html: string }
  waitUntil?: (p: Promise<unknown>) => void
  now?: () => Date
  hops?: number
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export async function handle(req: Request, d: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const b = await req.json().catch(() => null) as { email?: unknown; redirect?: unknown } | null
  if (!b || typeof b !== 'object') return json({ error: 'Bad request' }, 400)
  if (typeof b.redirect !== 'string' || !ALLOWED_REDIRECTS.includes(b.redirect)) return json({ error: 'redirect_not_allowed' }, 400)
  const email = normalizeEmail(b.email)
  if (!email) return json(GENERIC)

  const work = (async () => {
    try {
      const addr = clientAddress(req.headers, d.hops ?? 1)
      const now = d.now?.() ?? new Date()
      const tripped = await firstTripped(d.rpc, [
        { scope: 'link-ip', value: addr, window: 'hour', max: 10 },
        { scope: 'link-email', value: email, window: 'hour', max: 3 },
        { scope: 'link-all', value: null, window: 'hour', max: 20 },
      ], now)
      if (tripped === 'link-all') {
        const first = await d.rpc('alert_once', { p_kind: 'link-all-cap', p_window: hourWindow(now) })
        if (first.data === true) {
          await d.send({ to: ALERT_TO, subject: 'Fanday: sign-in email cap reached',
            html: '<p>Fanday sent its limit of 20 sign-in emails this hour; further requests are being ignored until the next hour. If you did not expect this, someone may be probing the sign-in form.</p>',
            text: 'Fanday sent its limit of 20 sign-in emails this hour; further requests are being ignored until the next hour. If you did not expect this, someone may be probing the sign-in form.' })
        }
      }
      if (tripped) return
      const found = await d.rpc('auth_user_id_by_email', { p_email: email })
      if (found.error) throw new Error('lookup failed')
      if (!found.data) {
        const id = await d.createUser(email)
        if (id) { const o = await d.rpc('set_user_origin', { p_user: id, p_created: true }); if (o.error) throw new Error('origin failed') }
      }
      const hashed = await d.generateLink(email)
      if (!hashed) throw new Error('no link')
      const mail = renderEmail(d.template.html, buildLink(b.redirect as string, hashed))
      await d.send({ to: email, subject: d.template.subject, ...mail })
    } catch (e) {
      console.error('fanday-send-link:', (e as Error).message) // never the address or the link
    }
  })()
  if (d.waitUntil) d.waitUntil(work); else await work
  return json(GENERIC)
}
