// Change detector: diff an incoming game against the stored row.
// Pure TypeScript, no Deno or Node APIs.

/** The fields the detector compares. Stored rows may carry more columns; they are ignored. */
export interface ComparableGame {
  kickoff_at: string | null;
  time_tbc: boolean;
  status: string;
  venue: string | null;
  broadcast?: string | null;
  source_rev?: number | string | null;
}

export type ChangeField = 'kickoff_at' | 'time_tbc' | 'status' | 'venue';

export interface FieldChange {
  field: ChangeField;
  old_value: string | null;
  new_value: string | null;
}

const collapse = (v: string | null | undefined): string | null => {
  const s = (v ?? '').replace(/[\s ]+/g, ' ').trim();
  return s === '' ? null : s;
};

const instant = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? v : new Date(t).toISOString().replace('.000Z', 'Z');
};

/**
 * Changes that must be recorded in game_changes and may trigger a push.
 * Whitespace-only differences, source_rev and broadcast never count.
 * Kickoff instants are compared as instants (so "+00:00" and "Z" are equal).
 */
export function detectChanges(stored: ComparableGame, incoming: ComparableGame): FieldChange[] {
  const out: FieldChange[] = [];
  const oldK = instant(stored.kickoff_at);
  const newK = instant(incoming.kickoff_at);
  if (oldK !== newK) out.push({ field: 'kickoff_at', old_value: oldK, new_value: newK });
  if (!!stored.time_tbc !== !!incoming.time_tbc) {
    out.push({ field: 'time_tbc', old_value: String(!!stored.time_tbc), new_value: String(!!incoming.time_tbc) });
  }
  const oldS = collapse(stored.status);
  const newS = collapse(incoming.status);
  if (oldS !== newS) out.push({ field: 'status', old_value: oldS, new_value: newS });
  const oldV = collapse(stored.venue);
  const newV = collapse(incoming.venue);
  if (oldV !== newV) out.push({ field: 'venue', old_value: oldV, new_value: newV });
  return out;
}

/** True when the stored row differs in anything we write, other than source_rev. */
export function needsUpdate(stored: ComparableGame, incoming: ComparableGame): boolean {
  if (detectChanges(stored, incoming).length > 0) return true;
  return collapse(stored.broadcast) !== collapse(incoming.broadcast);
}
