import { eq, done } from './_t.mjs'
import { makeLimiter } from '../supabase/functions/go/ratelimit.ts'

const allow = makeLimiter(3, 1000)
eq('first 3 in the window pass', [allow('a', 0), allow('a', 1), allow('a', 2)], [true, true, true])
eq('4th is limited', allow('a', 3), false)
eq('other callers are independent', allow('b', 3), true)
eq('window resets', allow('a', 1001), true)
const small = makeLimiter(1, 1000, 2)
small('x', 0); small('y', 0); small('z', 0)
eq('map is bounded', small('x', 1), true) // evicted/cleared rather than growing without limit
done()
