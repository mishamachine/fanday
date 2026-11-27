import { eq, ok, done } from './_t.mjs'
import { eventTitle, eventNotes, toCalendarEvent, dataCredit, DATA_CREDIT_FULL } from '../src/calendar/eventContent.ts'

const ctx = { goBaseUrl: 'https://ywcrzkvwamjchjjkfrve.supabase.co/functions/v1/fanday-go' }
const CREDIT = dataCredit(null)
const ID = 'aaaaaaaa-0000-0000-0000-000000000001'
// Shape copies the Game type / games table: nulls for everything the server hasn't filled.
const base = {
  id: ID, leagueId: 'nfl', sport: 'american_football', homeTeamId: 'nfl-kc', awayTeamId: 'nfl-den', homeName: 'Chiefs', awayName: 'Broncos',
  kickoffAt: '2026-11-08T20:20:00.000Z', gameDate: '2026-11-08', timeTbc: false, status: 'scheduled', venue: 'Arrowhead Stadium', broadcast: 'CBS',
  countryCode: 'US', previousKickoffAt: null, watchUrl: null, ticketsUrl: null, sponsorText: null, sponsorUrl: null,
}
eq('credit without article', CREDIT, 'Schedule data: Wikipedia contributors, CC BY-SA 4.0 (creativecommons.org/licenses/by-sa/4.0). Reformatted by Fanday.')
eq('credit with article', dataCredit('2026 Kansas City Chiefs season'),
  "Schedule data: Wikipedia contributors, '2026 Kansas City Chiefs season', CC BY-SA 4.0 (creativecommons.org/licenses/by-sa/4.0). Reformatted by Fanday.")
eq('settings credit', DATA_CREDIT_FULL,
  'Schedule data from Wikipedia, by Wikipedia contributors, licensed CC BY-SA 4.0 (creativecommons.org/licenses/by-sa/4.0). We take the dates, times and channels and change their format.')
ok('credits carry no link', !/https?:\/\//.test(CREDIT + DATA_CREDIT_FULL))
eq('title carries broadcaster', eventTitle(base), 'Chiefs vs Broncos · CBS')
eq('title without broadcaster', eventTitle({ ...base, broadcast: null }), 'Chiefs vs Broncos')
eq('title ignores blank broadcaster', eventTitle({ ...base, broadcast: '  ' }), 'Chiefs vs Broncos')

// Empty paid/sponsor lines are hidden entirely.
eq('notes with nothing paid: details + credit only', eventNotes(base, ctx), `TV: CBS\n\n${CREDIT}`)
const full = { ...base, watchUrl: 'https://watch.example/x', ticketsUrl: 'https://tix.example/x', sponsorText: 'Acme', sponsorUrl: 'https://acme.example' }
const notes = eventNotes(full, ctx)
ok('watch line labelled paid link, via /go', notes.includes(`Where to watch (paid link): ${ctx.goBaseUrl}/${ID}/watch`))
ok('tickets line labelled paid link, via /go', notes.includes(`Tickets (paid link): ${ctx.goBaseUrl}/${ID}/tickets`))
ok('sponsor line labelled paid link, via /go', notes.includes(`Presented by Acme (paid link): ${ctx.goBaseUrl}/${ID}/sponsor`))
ok('partner URLs never appear in notes', !notes.includes('watch.example') && !notes.includes('tix.example') && !notes.includes('acme.example'))
ok('data credit last', notes.endsWith(CREDIT))
eq('sponsor text without url: plain, no link', eventNotes({ ...base, sponsorText: 'Acme' }, ctx).includes('/fanday-go/'), false)
eq('only tickets: watch line hidden', eventNotes({ ...base, ticketsUrl: 'https://tix.example/x' }, ctx).includes('Where to watch'), false)

ok('notes name the source article, credit still last', eventNotes({ ...full, sourcePage: '2026 Kansas City Chiefs season' }, ctx).endsWith(dataCredit('2026 Kansas City Chiefs season')))
// Notes hold only our own wording and extracted facts: every line is a known label, never free Wikipedia prose.
const allowed = [/^TV: [^\n]+$/, /^Kickoff time to be confirmed\. This event updates when it is published\.$/, /^Postponed\. New date to be confirmed\.$/,
  /^Where to watch \(paid link\): https:\/\/\S+$/, /^Tickets \(paid link\): https:\/\/\S+$/, /^Presented by [^\n]+$/, /^Schedule data: Wikipedia contributors, /]
const odd = eventNotes({ ...full, status: 'postponed', timeTbc: true, sourcePage: '2026 Kansas City Chiefs season' }, ctx).split('\n').filter(Boolean).filter((l) => !allowed.some((r) => r.test(l)))
eq('every notes line is a known label or extracted fact', odd, [])

const ev = toCalendarEvent(base, ctx)
eq('timed event: location is the stadium', ev.location, 'Arrowhead Stadium')
eq('timed event: not all day, 30 min alarm', [ev.allDay, ev.alarmMinutesBefore], [false, 30])
eq('NFL duration 3.5h', (new Date(ev.endsAt) - new Date(ev.startsAt)) / 60000, 210)
const tbc = toCalendarEvent({ ...base, kickoffAt: null, timeTbc: true, venue: null, broadcast: null, sport: 'cricket' }, ctx)
eq('TBC game: all-day, no alarm, no location', [tbc.allDay, tbc.alarmMinutesBefore, tbc.location], [true, null, null])
eq('TBC game starts on its date', tbc.startsAt.slice(0, 10), '2026-11-08')
ok('TBC notes say so', tbc.notes.startsWith('Kickoff time to be confirmed'))
done()
