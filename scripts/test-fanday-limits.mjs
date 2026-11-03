import { ok, eq, done } from './_t.mjs'
import { allow, firstTripped, clientAddress, dayWindow, hourWindow, sha256Hex } from '../supabase/functions/_shared/fanday-limits.ts'

const H = (o) => ({ get: (k) => o[k] ?? null })
eq('windows', [hourWindow(new Date('2026-11-03T10:59:59Z')), dayWindow(new Date('2026-11-03T23:59:59Z'))], ['2026-11-03T10:00:00.000Z', '2026-11-03T00:00:00.000Z'])
eq('sha256 vector', await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
eq('address: platform header wins, spoofed first XFF ignored', [clientAddress(H({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' })), clientAddress(H({ 'x-forwarded-for': '6.6.6.6, 5.6.7.8' })), clientAddress(H({}))], ['1.2.3.4', '5.6.7.8', 'unknown'])
const store = new Map(), keys = []
const rpc = async (fn, a) => fn === 'rl_salt' ? { data: 'S', error: null } : (keys.push(a.p_key), store.set(a.p_key, (store.get(a.p_key) ?? 0) + 1), { data: store.get(a.p_key) <= a.p_limit, error: null })
const lim = [{ scope: 'ip', value: '1.2.3.4', window: 'hour', max: 2 }, { scope: 'all', value: null, window: 'hour', max: 5 }]
eq('allows within limits', [await allow(rpc, lim), await allow(rpc, lim), await allow(rpc, lim)], [true, true, false])
ok('refused caller did not consume the global budget (order matters)', store.get('all') === 2)
ok('the key is a salted hash: no address in it', keys.every((k) => k === 'all' || (/^[0-9a-f]{64}$/.test(k) && !k.includes('1.2.3.4'))))
ok('database error fails closed', (await allow(async () => ({ data: null, error: { message: 'x' } }), lim)) === false)
ok('missing salt fails closed', (await allow(async (fn) => fn === 'rl_salt' ? { data: null, error: null } : { data: true, error: null }, lim)) === false)
store.clear()
eq('firstTripped names the limit that tripped (caller before overall)', [await firstTripped(rpc, lim), await firstTripped(rpc, lim), await firstTripped(rpc, lim)], [null, null, 'ip'])
ok('firstTripped fails closed with "error"', (await firstTripped(async () => ({ data: null, error: { message: 'x' } }), lim)) === 'error')
done()
