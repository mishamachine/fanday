import { eq, ok, done } from './_t.mjs'
import { planSync, revision } from '../src/calendar/diff.ts'

const ev = (over = {}) => ({ title: 'A vs B', location: 'Park', notes: 'n', startsAt: '2026-11-07T12:30:00.000Z', endsAt: '2026-11-07T14:30:00.000Z', allDay: false, alarmMinutesBefore: 30, ...over })
const want = (gameId, over) => { const event = ev(over); return { gameId, event, rev: revision(event) } }
const have = (id, over) => ({ eventIdentifier: id, rev: revision(ev(over)) })
const keys = (p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.map((x) => x.gameId ?? x)]))

// revision: deterministic, sensitive to every written field, fits a bigint column
ok('revision is stable', revision(ev()) === revision(ev()))
for (const [f, v] of [['title', 'x'], ['location', null], ['notes', 'm'], ['startsAt', '2026-11-08T00:00:00.000Z'], ['endsAt', '2026-11-08T01:00:00.000Z'], ['allDay', true], ['alarmMinutesBefore', null]])
  ok(`revision changes with ${f}`, revision(ev({ [f]: v })) !== revision(ev()))
ok('revision is a uint32', Number.isInteger(revision(ev())) && revision(ev()) >= 0 && revision(ev()) < 2 ** 32)

// new
let p = planSync([want('g1')], {}, new Set())
eq('new game: create', keys(p), { create: ['g1'], update: [], recreate: [], remove: [], unchanged: [], retained: [] })
// unchanged
p = planSync([want('g1')], { g1: have('e1') }, new Set(['e1']))
eq('same content, identifier present: unchanged', keys(p), { create: [], update: [], recreate: [], remove: [], unchanged: ['g1'], retained: [] })
// changed
p = planSync([want('g1', { startsAt: '2026-11-07T15:00:00.000Z' })], { g1: have('e1') }, new Set(['e1']))
eq('changed content: update with the stored identifier', [keys(p).update, p.update[0].eventIdentifier], [['g1'], 'e1'])
// removed
p = planSync([], { g1: have('e1'), g2: have('e2') }, new Set(['e1']))
eq('not wanted: remove both (even one already missing)', p.remove, [{ gameId: 'g1', eventIdentifier: 'e1' }, { gameId: 'g2', eventIdentifier: 'e2' }])
// identifier lost (beats "changed": we write a fresh event either way)
p = planSync([want('g1', { title: 'new' })], { g1: have('e1') }, new Set())
eq('identifier gone: recreate, remembering the lost one', [keys(p).recreate, p.recreate[0].lostIdentifier, keys(p).update], [['g1'], 'e1', []])
// unknown stored rev (null) is treated as changed
p = planSync([want('g1')], { g1: { eventIdentifier: 'e1', rev: null } }, new Set(['e1']))
eq('rev null: update', keys(p).update, ['g1'])
// mixed, plus duplicates
p = planSync([want('n'), want('n'), want('c', { venue: 1, title: 'c2' }), want('u'), want('l')], { c: have('ec'), u: have('eu', {}), l: have('el'), r: have('er') }, new Set(['ec', 'eu', 'er']))
eq('mixed plan', keys(p), { create: ['n'], update: ['c'], recreate: ['l'], remove: ['r'], unchanged: ['u'], retained: [] })
// played game outside the window is retained; inside the window it is removed
const old = { eventIdentifier: 'eo', rev: 1, endsAt: '2026-10-01T14:00:00.000Z' }
p = planSync([], { old, inw: { eventIdentifier: 'ei', rev: 1, endsAt: '2026-11-07T14:00:00.000Z' }, noend: { eventIdentifier: 'en', rev: 1 } }, new Set(), Date.parse('2026-11-06'))
eq('window: old retained, in-window and unknown-end removed', [p.retained, p.remove.map((r) => r.gameId)], [['old'], ['inw', 'noend']])
done()
