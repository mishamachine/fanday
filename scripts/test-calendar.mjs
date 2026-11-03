import { eq, ok, done } from './_t.mjs'
import { MockCalendar } from '../src/calendar/mock.ts'
import { syncGames } from '../src/calendar/sync.ts'

const ctx = { goBaseUrl: 'https://x.invalid/functions/v1' }
const mk = (id, over = {}) => ({
  id, leagueId: 'epl', sport: 'soccer', homeTeamId: 'epl-ars', awayTeamId: 'epl-che', homeName: 'Arsenal', awayName: 'Chelsea',
  kickoffAt: '2026-11-07T12:30:00.000Z', gameDate: '2026-11-07', timeTbc: false, status: 'scheduled', venue: 'Emirates Stadium', broadcast: null,
  countryCode: 'GB', previousKickoffAt: null, watchUrl: null, ticketsUrl: null, sponsorText: null, sponsorUrl: null, ...over,
})
const tbc = (id) => mk(id, { kickoffAt: null, timeTbc: true })
const ids = (r) => Object.fromEntries(Object.entries(r.state).map(([g, d]) => [g, d.eventIdentifier]))

const cal = new MockCalendar()
let r = await syncGames(cal, [mk('g1'), tbc('g2')], {}, ctx)
ok('access granted, calendar created', r.granted && !!r.calendarId)
eq('two events created', [r.stats.created, Object.keys(r.state).length], [2, 2])
const [e1] = await cal.listEvents(r.calendarId, [r.state.g1.eventIdentifier])
eq('event written with title and location', [e1.title, e1.location], ['Arsenal vs Chelsea', 'Emirates Stadium'])
const [e2] = await cal.listEvents(r.calendarId, [r.state.g2.eventIdentifier])
eq('time TBC is an all-day event', [e2.allDay, e2.alarmMinutesBefore], [true, null])

// Idempotent: second run with the same input changes nothing.
const idsBefore = ids(r)
let r2 = await syncGames(cal, [mk('g1'), tbc('g2')], r.state, ctx)
eq('second run: nothing written', r2.stats, { created: 0, updated: 0, recreated: 0, removed: 0, unchanged: 2, retained: 0, orphans: 0, failed: 0 })
eq('second run: identifiers and revisions identical', r2.state, r.state)

// Kickoff moves: same event identifier, new time.
r = await syncGames(cal, [mk('g1', { kickoffAt: '2026-11-07T15:00:00.000Z' }), tbc('g2')], r2.state, ctx)
eq('moved game is one update', [r.stats.updated, r.stats.unchanged], [1, 1])
eq('moved game keeps its identifier', ids(r).g1, idsBefore.g1)
eq('moved game has the new time', (await cal.listEvents(r.calendarId, [r.state.g1.eventIdentifier]))[0].startsAt, '2026-11-07T15:00:00.000Z')

// Paid links appear and then disappear: notes change, event updated in place.
r = await syncGames(cal, [mk('g1', { kickoffAt: '2026-11-07T15:00:00.000Z', watchUrl: 'https://p.invalid/w' }), tbc('g2')], r.state, ctx)
eq('adding a paid link updates the event', r.stats.updated, 1)

// Identifier lost: the user deleted the event in their calendar app. It is written again, with the new identifier stored.
const lost = r.state.g2.eventIdentifier
await cal.deleteEvent(r.calendarId, lost)
r = await syncGames(cal, [mk('g1', { kickoffAt: '2026-11-07T15:00:00.000Z', watchUrl: 'https://p.invalid/w' }), tbc('g2')], r.state, ctx)
eq('lost identifier is recreated', [r.stats.recreated, r.stats.updated], [1, 0])
ok('recreated event has a new identifier', r.state.g2.eventIdentifier !== lost)
eq('and exists on the calendar', (await cal.listEvents(r.calendarId, [r.state.g2.eventIdentifier])).length, 1)

// Calendar itself reset: everything is recreated.
await cal.deleteCalendar(r.calendarId)
r = await syncGames(cal, [mk('g1', { kickoffAt: '2026-11-07T15:00:00.000Z', watchUrl: 'https://p.invalid/w' }), tbc('g2')], r.state, ctx)
eq('deleted calendar: both events recreated', [r.stats.recreated, r.stats.unchanged], [2, 0])

// Unfollow / cancel removes the event.
const g2id = r.state.g2.eventIdentifier
r = await syncGames(cal, [mk('g1', { status: 'cancelled' })], r.state, ctx)
eq('cancelled and unfollowed games are removed', [r.stats.removed, Object.keys(r.state).length, (await cal.listEvents(r.calendarId, [g2id])).length], [2, 0, 0])

// The same game twice (both teams followed) is one event.
r = await syncGames(cal, [mk('g1'), mk('g1')], {}, ctx)
eq('duplicate game rows give one event', [r.stats.created, Object.keys(r.state).length], [1, 1])

// One failing write does not stop the rest, and is retried next run.
class Flaky extends MockCalendar {
  failOnce = true
  async upsertEvent(c, e, x) { if (this.failOnce && e.title.includes('Chelsea') && !x) { this.failOnce = false; throw new Error('boom') } return super.upsertEvent(c, e, x) }
}
const fl = new Flaky()
const f1 = await syncGames(fl, [mk('a'), mk('b')], {}, ctx)
eq('one failure, one success', [f1.stats.failed, f1.stats.created], [1, 1])
const f2 = await syncGames(fl, [mk('a'), mk('b')], f1.state, ctx)
eq('failed one is retried, the good one untouched', [f2.stats.created, f2.stats.unchanged, f2.stats.failed], [1, 1, 0])

const denied = new MockCalendar(); denied.accessGranted = false
const d = await syncGames(denied, [mk('g1')], r.state, ctx)
eq('access denied: nothing changes', [d.granted, d.state], [false, r.state])

// Orphan sweep: strays in OUR calendar (duplicates, identifiers the OS changed) are deleted; tracked events are not.
{
  const c = new MockCalendar()
  const a = await syncGames(c, [mk('g1'), mk('g2')], {}, ctx)
  const base = { title: 'dup', location: null, notes: '', startsAt: '2026-11-07T10:00:00.000Z', endsAt: '2026-11-07T12:00:00.000Z', allDay: false, alarmMinutesBefore: null }
  const stray = (await c.upsertEvent(a.calendarId, base, null)).eventIdentifier
  const b = await syncGames(c, [mk('g1'), mk('g2')], a.state, ctx)
  eq('sweep removes the stray, keeps tracked events', [b.stats.orphans, b.stats.unchanged], [1, 2])
  eq('stray gone, tracked remain', (await c.listEvents(a.calendarId, [stray, a.state.g1.eventIdentifier, a.state.g2.eventIdentifier])).length, 2)
  // The OS changed an identifier: stored id missing -> recreate; the event now under the unknown id is swept, not duplicated.
  await c.deleteEvent(a.calendarId, a.state.g1.eventIdentifier)
  const unknown = (await c.upsertEvent(a.calendarId, base, null)).eventIdentifier
  const r3 = await syncGames(c, [mk('g1'), mk('g2')], b.state, ctx)
  eq('lost id recreated, unknown copy swept', [r3.stats.recreated, r3.stats.orphans], [1, 1])
  eq('unknown copy is gone', (await c.listEvents(a.calendarId, [unknown])).length, 0)
  class F extends MockCalendar { async upsertEvent(c2, e, x) { if (!x) throw new Error('boom'); return super.upsertEvent(c2, e, x) } }
  const fr = await syncGames(new F(), [mk('z')], {}, ctx)
  eq('failed write: no sweep', [fr.stats.failed, fr.stats.orphans], [1, 0])
}

// Past games stay: a played game that falls out of the fetch window keeps its event (history).
{
  const c = new MockCalendar()
  const past = mk('old', { kickoffAt: '2026-10-01T12:00:00.000Z', gameDate: '2026-10-01' })
  const a = await syncGames(c, [past, mk('g1')], {}, ctx)
  const windowStart = Date.parse('2026-11-06')
  const b = await syncGames(c, [mk('g1')], a.state, ctx, windowStart)
  eq('played game outside the window: retained, not removed', [b.stats.retained, b.stats.removed, 'old' in b.state], [1, 0, true])
  eq('its event is still on the calendar and not swept', [(await c.listEvents(a.calendarId, [a.state.old.eventIdentifier])).length, b.stats.orphans], [1, 0])
  const b2 = await syncGames(c, [], b.state, ctx, windowStart)
  eq('unfollowed game inside the window is removed, history stays', [b2.stats.removed, b2.stats.retained, 'old' in b2.state], [1, 1, true])
}
done()
