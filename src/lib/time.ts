// Time display. The format follows the game's country: 12-hour for US-style countries, 24-hour for UK/EU and the rest.
// The set below is a product choice (README: "12h US, 24h UK/EU"); CA, AU, NZ and IN are assumed 12h [unverified].
const TWELVE_HOUR = new Set(['US', 'CA', 'AU', 'NZ', 'IN'])

export const uses12h = (countryCode: string) => TWELVE_HOUR.has(countryCode.toUpperCase())

export interface TimeOpts { timeZone?: string }

/** "7:20 pm" or "12:30". */
export function formatTime(iso: string, countryCode: string, opts: TimeOpts = {}): string {
  const h12 = uses12h(countryCode)
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', hour12: h12, timeZone: opts.timeZone,
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const hh = get('hour'), mm = get('minute')
  return h12 ? `${hh}:${mm} ${get('dayPeriod').toLowerCase()}` : `${hh}:${mm}`
}

/** "SUN" */
export function formatWeekday(isoOrDate: string, opts: TimeOpts = {}): string {
  const d = isoOrDate.length === 10 ? new Date(`${isoOrDate}T12:00:00Z`) : new Date(isoOrDate)
  const tz = isoOrDate.length === 10 ? 'UTC' : opts.timeZone
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: tz }).format(d).toUpperCase()
}

/** "8 Nov" */
export function formatDay(isoOrDate: string, opts: TimeOpts = {}): string {
  const d = isoOrDate.length === 10 ? new Date(`${isoOrDate}T12:00:00Z`) : new Date(isoOrDate)
  const tz = isoOrDate.length === 10 ? 'UTC' : opts.timeZone
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz }).format(d)
}
