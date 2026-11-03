import { eq, done } from './_t.mjs'
import { formatTime, formatWeekday, formatDay, uses12h } from '../src/lib/time.ts'

// 2026-11-08T20:20Z is Sunday. Zone pinned so the test doesn't depend on the machine.
eq('US game: 12-hour', formatTime('2026-11-08T20:20:00Z', 'US', { timeZone: 'UTC' }), '8:20 pm')
eq('US game: morning', formatTime('2026-11-08T09:05:00Z', 'US', { timeZone: 'UTC' }), '9:05 am')
eq('UK game: 24-hour', formatTime('2026-11-07T12:30:00Z', 'GB', { timeZone: 'UTC' }), '12:30')
eq('EU game: 24-hour with leading zero', formatTime('2026-11-07T08:05:00Z', 'DE', { timeZone: 'UTC' }), '08:05')
eq('UCL (EU) is 24-hour', uses12h('EU'), false)
eq('zone applied', formatTime('2026-11-08T20:20:00Z', 'US', { timeZone: 'America/Chicago' }), '2:20 pm')
eq('weekday', formatWeekday('2026-11-08T20:20:00Z', { timeZone: 'UTC' }), 'SUN')
eq('date-only weekday ignores local zone', formatWeekday('2026-11-08'), 'SUN')
eq('day', formatDay('2026-11-08'), '8 Nov')
done()
