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
eq('second run: nothing written', r2.stats, { created: 0, updated: 0, recreated: 0, removed: 0, unchanged: 2, failed: 0 })
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
done()
