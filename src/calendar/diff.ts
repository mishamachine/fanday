import type { CalendarEventInput } from './types.ts'

/** What we remember per game on this device: the calendar's event identifier and the content revision we wrote. */
export interface DeviceEvent { eventIdentifier: string; rev: number | null }
/** gameId -> DeviceEvent. Mirrors the device_events table (event_identifier, synced_rev). */
export type DeviceState = Record<string, DeviceEvent>

export interface DesiredEvent { gameId: string; event: CalendarEventInput; rev: number }

export interface Plan {
  create: DesiredEvent[]
  /** Identifier still exists but the content changed (kickoff moved, venue, links...). */
  update: Array<DesiredEvent & { eventIdentifier: string }>
  /** We hold an identifier but the event is gone from the calendar (user deleted it, calendar was reset): write it again. */
  recreate: Array<DesiredEvent & { lostIdentifier: string }>
  /** No longer wanted (unfollowed, cancelled, out of the window). */
  remove: Array<{ gameId: string; eventIdentifier: string }>
  unchanged: string[]
}

/**
 * Content revision of an event: FNV-1a (32 bit) over every field we write. Stored as device_events.synced_rev (bigint).
 * Hashing the content, not games.updated_at, also catches changes that do not bump the game row (a new link base URL).
 */
export function revision(e: CalendarEventInput): number {
  const s = JSON.stringify([e.title, e.location, e.notes, e.startsAt, e.endsAt, e.allDay, e.alarmMinutesBefore])
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h
}

/**
 * Pure diff. `present` is the set of stored identifiers the calendar still has (from listEvents).
 * A second run over unchanged input yields only `unchanged`.
 */
export function planSync(desired: DesiredEvent[], state: DeviceState, present: ReadonlySet<string>): Plan {
  const plan: Plan = { create: [], update: [], recreate: [], remove: [], unchanged: [] }
  const wanted = new Set<string>()
  for (const d of desired) {
    if (wanted.has(d.gameId)) continue // the same game can arrive twice when both teams are followed
    wanted.add(d.gameId)
    const have = state[d.gameId]
    if (!have) plan.create.push(d)
    else if (!present.has(have.eventIdentifier)) plan.recreate.push({ ...d, lostIdentifier: have.eventIdentifier })
    else if (have.rev !== d.rev) plan.update.push({ ...d, eventIdentifier: have.eventIdentifier })
    else plan.unchanged.push(d.gameId)
  }
  for (const [gameId, have] of Object.entries(state)) {
    if (!wanted.has(gameId)) plan.remove.push({ gameId, eventIdentifier: have.eventIdentifier })
  }
  return plan
}
