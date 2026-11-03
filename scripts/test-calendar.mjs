import { eq, ok, done } from './_t.mjs'
import { MockCalendar } from '../src/calendar/mock.ts'
import { syncGames } from '../src/calendar/sync.ts'

const ctx = { goBaseUrl: 'https://x.invalid/functions/v1/fanday-go' }
const mk = (id, over = {}) => ({
  id, leagueId: 'epl', sport: 'soccer', homeTeamId: 'epl-ars', awayTeamId: 'epl-che', homeName: 'Arsenal', awayName: 'Chelsea',
  kickoffAt: '2026-11-07T12:30:00.000Z', gameDate: '2026-11-07', timeTbc: false, status: 'scheduled', venue: 'Emirates Stadium', broadcast: null,
  countryCode: 'GB', previousKickoffAt: null, watchUrl: null, ticketsUrl: null, sponsorText: null, sponsorUrl: null, ...over,
})

const cal = new MockCalendar()
let r = await syncGames(cal, [mk('g1'), mk('g2', { kickoffAt: null, timeTbc: true })], {}, ctx)
ok('access granted, calendar created', r.granted && !!r.calendarId)
eq('two events stored', Object.keys(r.ids).length, 2)
const [e1] = await cal.listEvents(r.calendarId, [r.ids.g1])
eq('event written with title and location', [e1.title, e1.location], ['Arsenal vs Chelsea', 'Emirates Stadium'])

// Kickoff moves: same event identifier, new time.
r = await syncGames(cal, [mk('g1', { kickoffAt: '2026-11-07T15:00:00.000Z' }), mk('g2', { kickoffAt: null, timeTbc: true })], r.ids, ctx)
const [e1b] = await cal.listEvents(r.calendarId, [r.ids.g1])
eq('moved game updates in place', e1b.startsAt, '2026-11-07T15:00:00.000Z')
eq('listEvents by stored identifier returns both', (await cal.listEvents(r.calendarId, Object.values(r.ids))).length, 2)

// Unfollow / cancel removes the event.
const before = r.ids.g2
r = await syncGames(cal, [mk('g1', { status: 'cancelled' })], r.ids, ctx)
eq('cancelled and unfollowed games are removed', [Object.keys(r.ids).length, (await cal.listEvents(r.calendarId, [before])).length], [0, 0])

// Re-running is stable (no duplicates).
const again = await syncGames(cal, [mk('g1')], {}, ctx)
const again2 = await syncGames(cal, [mk('g1')], again.ids, ctx)
eq('re-sync keeps the same identifier', again2.ids.g1, again.ids.g1)
eq('createCalendar reuses the Fanday calendar', again.calendarId, again2.calendarId)

cal.accessGranted = false
const denied = await syncGames(cal, [mk('g1')], again.ids, ctx)
eq('access denied: nothing changes', [denied.granted, denied.ids], [false, again.ids])

await cal.deleteCalendar(again.calendarId)
eq('deleteCalendar removes its events', (await cal.listEvents(again.calendarId, [again.ids.g1])).length, 0)
done()
