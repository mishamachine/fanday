import { eq, done } from './_t.mjs'
import { makeLimiter, clientKey } from '../supabase/functions/fanday-go/ratelimit.ts'

const allow = makeLimiter(3, 1000)
eq('first 3 in the window pass', [allow('a', 0), allow('a', 1), allow('a', 2)], [true, true, true])
eq('4th is limited', allow('a', 3), false)
eq('other callers are independent', allow('b', 3), true)
eq('window resets', allow('a', 1001), true)
const small = makeLimiter(1, 1000, 2)
small('x', 0); small('y', 0); small('z', 0)
eq('map is bounded', small('x', 1), true) // evicted/cleared rather than growing without limit

const H = (o) => ({ get: (k) => o[k] ?? null })
eq('cf-connecting-ip wins', clientKey(H({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9, 5.6.7.8' })), '1.2.3.4')
eq('spoofed first XFF entry is ignored: last (proxy-added) entry used', clientKey(H({ 'x-forwarded-for': '6.6.6.6, 5.6.7.8' })), '5.6.7.8')
eq('hops=2 takes the second from the right', clientKey(H({ 'x-forwarded-for': '6.6.6.6, 5.6.7.8, 10.0.0.1' }), 2), '5.6.7.8')
eq('single entry', clientKey(H({ 'x-forwarded-for': '5.6.7.8' })), '5.6.7.8')
eq('no headers: shared bucket', clientKey(H({})), 'unknown')
done()
