// fanday-send-link: allow-list, generic reply, limits, fanday_created on new users only, link shape, no leak of account existence.
import { ok, eq, done } from './_t.mjs'
import { handle } from '../supabase/functions/fanday-send-link/handler.ts'
import { ALLOWED_REDIRECTS, buildLink, normalizeEmail, renderEmail, GENERIC } from '../supabase/functions/fanday-send-link/link.ts'
import { TEMPLATE_HTML, SUBJECT } from '../supabase/functions/fanday-send-link/template.ts'

const NATIVE = 'com.bbprojectfactory.fanday://auth/callback', WEB = 'https://fanday.bbprojectfactory.com/auth/callback'
eq('allow-list is exactly the two URLs from the brief', ALLOWED_REDIRECTS, [NATIVE, WEB])
eq('normalize', ['  A@B.co ', 'a@b', 'a b@c.de', 'a@b.co,x@y.zz', 5, ''].map(normalizeEmail), ['a@b.co', null, null, null, null, null])
eq('link: token_hash + type=magiclink on the redirect', buildLink(NATIVE, 'TOK'), `${NATIVE}?token_hash=TOK&type=magiclink`)
ok('link: https redirect works too', buildLink(WEB, 'TOK') === `${WEB}?token_hash=TOK&type=magiclink`)
const { html, text } = renderEmail(TEMPLATE_HTML, `${WEB}?token_hash=T&type=magiclink`)
ok('email: link substituted in all 3 places (button, fallback href and text), & escaped, no placeholder left', !html.includes('{{') && html.split('token_hash=T&amp;type=magiclink').length === 4 && text.includes('token_hash=T&type=magiclink'))
ok('email: subject starts with "Fanday:"', SUBJECT.startsWith('Fanday:'))

// ---- handler with fakes
function world({ existing = [], failSend = false } = {}) {
  const w = { users: new Set(existing), created: [], links: [], sent: [], counters: new Map(), salt: 'salt-1', errors: [] }
  w.deps = {
    rpc: async (fn, a) => {
      if (fn === 'rl_salt') return { data: w.salt, error: null }
      if (fn === 'rl_hit') { const k = `${a.p_scope}|${a.p_key}|${a.p_window}`; const n = (w.counters.get(k) ?? 0) + 1; w.counters.set(k, n); return { data: n <= a.p_limit, error: null } }
      if (fn === 'auth_user_id_by_email') return { data: w.users.has(a.p_email) ? 'uid' : null, error: null }
      return { data: null, error: { message: 'unknown' } }
    },
    createUser: async (e) => { w.users.add(e); w.created.push({ email: e, app_metadata: { fanday_created: true } }) },
    generateLink: async (e) => { w.links.push(e); return `hash-${e}` },
    send: async (m) => { if (failSend) throw new Error('smtp down'); w.sent.push(m) },
    template: { subject: SUBJECT, html: TEMPLATE_HTML },
    now: () => new Date('2026-11-03T10:30:00Z'),
  }
  return w
}
const call = (w, body, headers = { 'x-forwarded-for': '9.9.9.9, 5.6.7.8' }) =>
  handle(new Request('https://f.test/', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }), w.deps)
const j = async (r) => ({ status: r.status, body: await r.json() })

let w = world({ existing: ['known@x.com'] })
const known = await j(await call(w, { email: 'known@x.com', redirect: NATIVE }))
const fresh = await j(await call(w, { email: 'new@x.com', redirect: NATIVE }, { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))
const junk = await j(await call(w, { email: 'not-an-email', redirect: NATIVE }))
eq('same reply for an existing address, a new address and a malformed one', [known, fresh, junk].map((x) => [x.status, x.body]), [[200, GENERIC], [200, GENERIC], [200, GENERIC]])
eq('only the NEW address is created, with fanday_created = true; the existing user is not touched', w.created, [{ email: 'new@x.com', app_metadata: { fanday_created: true } }])
eq('a link is sent to both real addresses, none to the malformed one', w.sent.map((m) => m.to), ['known@x.com', 'new@x.com'])
ok('mail: subject starts "Fanday:", link carries token_hash, redirect honoured', w.sent.every((m) => m.subject.startsWith('Fanday:') && m.text.includes(`${NATIVE}?token_hash=hash-`) && m.html.includes('token_hash=hash-')))

w = world()
const bad = await Promise.all([{ email: 'a@x.com', redirect: 'https://evil.example/auth/callback' }, { email: 'a@x.com', redirect: NATIVE + '/x' }, { email: 'a@x.com' }, { email: 'a@x.com', redirect: `${WEB}?x=1` }].map((b) => call(w, b).then((r) => r.status)))
eq('redirects outside the allow-list are refused (400) before any work', bad, [400, 400, 400, 400]); ok('...and nothing was created, linked or sent', !w.created.length && !w.links.length && !w.sent.length)
eq('not JSON / wrong method', [(await call(w, 'nope')).status, (await handle(new Request('https://f.test/', { method: 'GET' }), w.deps)).status], [400, 405])

w = world()
const same = []; for (let i = 0; i < 5; i++) same.push((await j(await call(w, { email: 'same@x.com', redirect: WEB }))))
ok('per address: 3 per hour; the 4th and 5th get the same generic reply but no mail', same.every((x) => x.status === 200 && JSON.stringify(x.body) === JSON.stringify(GENERIC)) && w.sent.length === 3)

w = world()
for (let i = 0; i < 30; i++) await call(w, { email: `u${i}@x.com`, redirect: WEB }, { 'x-forwarded-for': `10.0.0.${i}` })
ok('overall: 20 per hour across all callers', w.sent.length === 20, String(w.sent.length))

w = world()
for (let i = 0; i < 14; i++) await call(w, { email: `p${i}@x.com`, redirect: WEB }, { 'x-forwarded-for': '7.7.7.7' })
ok('per caller: 10 per hour from one address; the global budget is not eaten by the refused ones', w.sent.length === 10 && ![...w.counters.keys()].some((k) => k.startsWith('link-all') && w.counters.get(k) > 10))
ok('counters hold hashes, never the address or email', [...w.counters.keys()].every((k) => !k.includes('7.7.7.7') && !k.includes('@')))

w = world({ failSend: true })
const failed = await j(await call(w, { email: 'x@y.com', redirect: WEB }))
eq('an SMTP failure still gives the generic reply (no oracle)', [failed.status, failed.body], [200, GENERIC])

// the reply is returned before the work finishes when the runtime offers waitUntil (hides the extra createUser time of new users)
w = world(); let pending = null; w.deps.waitUntil = (p) => { pending = p }
let release; const gate = new Promise((r) => { release = r }); w.deps.generateLink = async () => { await gate; return 'h' }
const early = await call(w, { email: 'slow@x.com', redirect: WEB })
ok('reply does not wait for the mail work', early.status === 200 && w.sent.length === 0 && !!pending); release(); await pending
ok('...and the work completes afterwards', w.sent.length === 1)
done()
