import type { Game } from '../data/types.ts'
import type { CalendarEventInput } from './types.ts'

/** Plain text only: the licence address is shown, never linked. */
export const LICENCE_TEXT = 'CC BY-SA 4.0 (creativecommons.org/licenses/by-sa/4.0)'

/** Settings credit: licence version, authors, licence address, and that we changed the data. */
export const DATA_CREDIT_FULL =
  `Schedule data from Wikipedia, by Wikipedia contributors, licensed ${LICENCE_TEXT}. We take the dates, times and channels and change their format.`

/** Credit for one event's notes; names the source article when the game record has it. */
export function dataCredit(sourcePage?: string | null): string {
  const title = (sourcePage ?? '').trim()
  return `Schedule data: Wikipedia contributors, ${title ? `'${title}', ` : ''}${LICENCE_TEXT}. Reformatted by Fanday.`
}

const DURATION_MIN: Record<string, number> = {
  soccer: 120, american_football: 210, basketball: 150, hockey: 150, baseball: 180,
  cricket: 210, aussie_rules: 180, rugby_league: 120,
}

export interface EventContext {
  /** Base URL of the `fanday-go` Edge Function, e.g. https://<ref>.supabase.co/functions/v1/fanday-go (no trailing slash). */
  goBaseUrl: string
}

const goLink = (ctx: EventContext, gameId: string, slot: string) => `${ctx.goBaseUrl}/${gameId}/${slot}`
const clean = (s: string | null | undefined) => (s ?? '').trim()

/** "Chiefs vs Broncos · CBS" (broadcaster only when we have one). */
export function eventTitle(g: Game): string {
  const tv = clean(g.broadcast)
  return `${g.homeName} vs ${g.awayName}${tv ? ` · ${tv}` : ''}`
}

/**
 * Notes block (build-plan.md): details, then "Where to watch", "Tickets", "Presented by", then the data credit.
 * Every line is either a fact we extracted (TV channel, times) or our own wording; no Wikipedia prose is copied.
 * Paid lines say "paid link"; a line with nothing behind it is left out entirely.
 */
export function eventNotes(g: Game, ctx: EventContext): string {
  const lines: string[] = []
  if (g.timeTbc || !g.kickoffAt) lines.push('Kickoff time to be confirmed. This event updates when it is published.')
  if (g.status === 'postponed') lines.push('Postponed. New date to be confirmed.')
  const tv = clean(g.broadcast)
  if (tv) lines.push(`TV: ${tv}`)
  const paid: string[] = []
  if (clean(g.watchUrl)) paid.push(`Where to watch (paid link): ${goLink(ctx, g.id, 'watch')}`)
  if (clean(g.ticketsUrl)) paid.push(`Tickets (paid link): ${goLink(ctx, g.id, 'tickets')}`)
  const sponsor = clean(g.sponsorText)
  if (sponsor) paid.push(clean(g.sponsorUrl) ? `Presented by ${sponsor} (paid link): ${goLink(ctx, g.id, 'sponsor')}` : `Presented by ${sponsor}`)
  const parts = [lines.join('\n'), paid.join('\n'), dataCredit(g.sourcePage)].filter(Boolean)
  return parts.join('\n\n')
}

export function toCalendarEvent(g: Game, ctx: EventContext): CalendarEventInput {
  const allDay = g.timeTbc || !g.kickoffAt
  const start = g.kickoffAt ?? `${g.gameDate}T00:00:00.000Z`
  const mins = DURATION_MIN[g.sport] ?? 180
  const end = allDay ? start : new Date(new Date(start).getTime() + mins * 60_000).toISOString()
  return {
    title: eventTitle(g), location: clean(g.venue) || null, notes: eventNotes(g, ctx),
    startsAt: start, endsAt: end, allDay, alarmMinutesBefore: allDay ? null : 30,
  }
}
