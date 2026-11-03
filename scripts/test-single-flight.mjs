import { eq, done } from './_t.mjs'
import { singleFlight } from '../src/calendar/singleFlight.ts'

const gate = () => { let go; const p = new Promise((r) => { go = r }); return { p, go } }
let runs = 0, active = 0, maxActive = 0
const gates = []
const sf = singleFlight(async () => {
  const n = ++runs; active++; maxActive = Math.max(maxActive, active)
  const g = gate(); gates.push(g); await g.p
  active--; return n
})
const tick = () => new Promise((r) => setTimeout(r, 5))

const a = sf()
await tick()
eq('first call starts one run', runs, 1)
// Three requests while it runs collapse into exactly one queued run, not three and not zero.
const b = sf(), c = sf(), d = sf()
await tick()
eq('requests during a run do not start a second one beside it', [runs, maxActive], [1, 1])
gates[0].go()
eq('first run result', await a, 1)
await tick()
eq('then exactly one queued run starts', runs, 2)
gates[1].go()
eq('all queued callers share that one run', [await b, await c, await d], [2, 2, 2])
await tick()
eq('and no third run', runs, 2)
// After everything finishes, a new call starts fresh.
const e = sf(); await tick(); gates[2].go()
eq('idle again: new call runs', [await e, runs, maxActive], [3, 3, 1])
// A failing run does not block the queued one.
let n2 = 0
const sf2 = singleFlight(async () => { n2++; if (n2 === 1) { await tick(); throw new Error('x') } return n2 })
const p1 = sf2().catch(() => 'failed'), p2 = sf2()
eq('failure does not stop the queued run', [await p1, await p2], ['failed', 2])
done()
