import { eq, ok, done } from './_t.mjs'
import { toWire, fromWire } from '../src/calendar/wire.ts'
import { statusFor, statusText, retryDelay } from '../src/calendar/status.ts'
import { qaShiftMs } from '../src/lib/qa.ts'
import { readFileSync, readdirSync } from 'node:fs'

const timed = { title: 'A vs B', location: 'Park', notes: 'n', startsAt: '2026-11-07T12:30:00.000Z', endsAt: '2026-11-07T14:30:00.000Z', allDay: false, alarmMinutesBefore: 30 }
// The JSON the native side receives: epoch ms must be whole numbers (Kotlin reads them as Long, Swift as NSNumber/Int64).
const wire = JSON.parse(JSON.stringify(toWire(timed)))
eq('timed payload', wire, { title: 'A vs B', location: 'Park', notes: 'n', startMs: 1794054600000, endMs: 1794061800000, allDay: false, alarmMinutesBefore: 30 })
ok('startMs/endMs are integers', Number.isInteger(wire.startMs) && Number.isInteger(wire.endMs))
ok('epoch ms is beyond int32 (so native must read Long, not Int)', wire.startMs > 2 ** 31)
const allDay = JSON.parse(JSON.stringify(toWire({ ...timed, location: null, allDay: true, alarmMinutesBefore: null, startsAt: '2026-11-07T00:00:00.000Z', endsAt: '2026-11-07T00:00:00.000Z' })))
eq('all-day payload: date part, no null fields', [allDay.allDayDate, 'location' in allDay, 'alarmMinutesBefore' in allDay], ['2026-11-07', false, false])
ok('payload never names a calendar', !('calendarId' in wire) && !('calendarId' in allDay))
try { toWire({ ...timed, startsAt: 'nope' }); ok('bad date throws', false) } catch { ok('bad date throws', true) }
// round trip
const back = fromWire({ ...wire, eventIdentifier: '7', calendarId: '1' })
eq('round trip keeps the instants', [back.startsAt, back.endsAt, back.allDay], [timed.startsAt, timed.endsAt, false])

// Failures are visible: any failed event makes the pass partial, with the count, and never "up to date".
const stats = (failed) => ({ created: 1, updated: 0, recreated: 0, removed: 0, unchanged: 0, retained: 0, orphans: 0, failed })
eq('clean pass is ok', statusFor(stats(0)), { status: 'ok', failed: 0 })
eq('failed events make it partial', statusFor(stats(2)), { status: 'partial', failed: 2 })
eq('texts', [statusText('ok'), statusText('partial', 2), statusText('partial', 1), statusText('denied')], ['Calendar up to date', "Couldn't add 2 games, retrying", "Couldn't add 1 game, retrying", 'Calendar access is off'])
ok('partial never reads as up to date', !statusText('partial', 3).includes('up to date'))
eq('retry delays then stop', [retryDelay(0), retryDelay(1), retryDelay(2), retryDelay(3)], [20000, 60000, 180000, null])

// QA flag: off unless dev or VITE_QA=1
eq('release build ignores the shift', qaShiftMs({ DEV: false, VITE_QA_SHIFT_MIN: '30' }), 0)
eq('VITE_QA=1 enables it', qaShiftMs({ DEV: false, VITE_QA: '1', VITE_QA_SHIFT_MIN: '30' }), 1_800_000)
eq('dev enables it', qaShiftMs({ DEV: true, VITE_QA_SHIFT_MIN: '-15' }), -900_000)
eq('garbage is 0', qaShiftMs({ DEV: true, VITE_QA_SHIFT_MIN: 'x' }), 0)
const bad = ['.env.example', ...readdirSync('.github/workflows').map((f) => `.github/workflows/${f}`)].filter((f) => /VITE_QA/.test(readFileSync(f, 'utf8')))
eq('no env example or workflow sets VITE_QA', bad, [])
done()
