// Edge Function hardening: which functions may hold the service-role key, per-function secrets, pinned imports, fanday-device behaviour.
import { ok, eq, done } from './_t.mjs'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { handle } from '../supabase/functions/fanday-device/handler.ts'
import { createRestDb } from '../supabase/functions/fanday-ingest/db-rest.ts'

const root = new URL('../supabase/functions/', import.meta.url).pathname
const files = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [] })
const text = (p) => readFileSync(p, 'utf8')

// ---- only fanday-send-link and fanday-delete-account may name the service-role / secret key
const holders = new Set()
for (const f of files(root)) if (/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEYS/.test(text(f).replace(/\/\/.*$/gm, ''))) holders.add(f.slice(root.length).split('/')[0])
eq('service-role key is used by exactly fanday-send-link and fanday-delete-account', [...holders].sort(), ['fanday-delete-account', 'fanday-send-link'])
for (const fn of ['fanday-ingest', 'fanday-go', 'fanday-device']) ok(`${fn}: uses the publishable key (SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEYS)`, files(join(root, fn)).some((f) => /SUPABASE_(ANON_KEY|PUBLISHABLE_KEYS)/.test(text(f))))
ok('go and device pass their own secrets to the RPC', /FANDAY_GO_SECRET/.test(text(join(root, 'fanday-go/index.ts'))) && /FANDAY_DEVICE_SECRET/.test(text(join(root, 'fanday-device/index.ts'))))

// ---- every import is exact-pinned
const bad = []
for (const f of files(root)) {
  for (const m of text(f).matchAll(/(?:import|export)\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/g)) {
    const u = m[1]
    if (u.startsWith('./') || u.startsWith('../')) continue
    const okPin = /^jsr:@[\w-]+\/[\w-]+@\d+\.\d+\.\d+\//.test(u) || /^https:\/\/esm\.sh\/@?[\w./-]+@\d+\.\d+\.\d+\?pin=v\d+$/.test(u) || /^https:\/\/deno\.land\/x\/[\w-]+@\d+\.\d+\.\d+\//.test(u)
    if (!okPin) bad.push(`${f.slice(root.length)}: ${u}`)
  }
}
eq('every non-relative import is pinned to an exact version (jsr @x.y.z, esm.sh @x.y.z?pin=vNNN, deno.land/x @x.y.z)', bad, [])
ok('denomailer is pinned to 1.6.0 (source read 2026-11-05: only std@0.173.0 base64, network only Deno.connect/connectTls)', /denomailer@1\.6\.0\//.test(text(join(root, 'fanday-send-link/smtp.ts'))))

// ---- ingest REST bodies carry the secret
const calls = []
const db = createRestDb('https://x.test', 'pub', 'sek', async (url, init) => { calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null, key: init.headers.apikey }); return new Response('[]', { status: 200 }) })
await db.apply({ inserts: [], updates: [], changes: [] }); await db.setLeagueSeason('epl', '2026-27'); await db.setTeamWikiPage('x', 'Y')
ok('ingest RPC calls include p_secret and use the publishable key', calls.length === 3 && calls.every((c) => c.body.p_secret === 'sek' && c.key === 'pub'))

// ---- fanday-device handler
const req = (body, method = 'POST', headers = {}) => new Request('https://f.test/', { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
let seen = null
const dev = (over = {}) => ({ secret: 'device-secret-0123456789', issue: async (a) => { seen = a; return { error: null } }, ...over })
let r = await handle(req({ action: 'register' }, 'POST', { 'x-forwarded-for': '9.9.9.9, 5.6.7.8' }), dev())
const body = await r.json()
ok('register: 200 and a 64-hex token', r.status === 200 && /^[0-9a-f]{64}$/.test(body.token))
ok('the RPC gets sha256(token) as bytea hex, the secret and the platform-set address; never the token', seen.p_hash === `\\x${[...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.token)))].map((b) => b.toString(16).padStart(2, '0')).join('')}` && seen.p_secret === 'device-secret-0123456789' && seen.p_addr === '5.6.7.8' && !JSON.stringify(seen).includes(body.token))
eq('rate-limited by the database -> 429', (await handle(req({ action: 'register' }), dev({ issue: async () => ({ error: { message: 'rate_limited' } }) }))).status, 429)
eq('database/secret error -> 503, no token', await (async () => { const x = await handle(req({ action: 'register' }), dev({ issue: async () => ({ error: { message: 'forbidden' } }) })); return [x.status, (await x.json()).token] })(), [503, undefined])
eq('no secret configured -> 503 without calling the database', await (async () => { let called = false; const x = await handle(req({ action: 'register' }), dev({ secret: undefined, issue: async () => { called = true; return { error: null } } })); return [x.status, called] })(), [503, false])
eq('other action / method', [(await handle(req({ action: 'x' }), dev())).status, (await handle(req(undefined, 'GET'), dev())).status], [400, 405])
done()
