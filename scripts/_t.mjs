// Tiny assert helper shared by scripts/test-*.mjs. Node 22+ strips TypeScript types, so tests import src/*.ts directly.
let fails = 0
export const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${cond ? '' : extra}`) }
export const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`)
export const done = () => { if (fails) { console.log(`${fails} FAILED`); process.exit(1) } }
