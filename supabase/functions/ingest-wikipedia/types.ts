// Shared types for the Wikipedia ingest. Pure TypeScript: no Deno or Node APIs.

export type GameStatus = 'scheduled' | 'final' | 'postponed' | 'cancelled';

/** A team as written on the source page. `page` is the linked Wikipedia article, if any. */
export interface TeamRef {
  name: string;
  page: string | null;
}

export interface ParsedGame {
  home: TeamRef;
  away: TeamRef;
  /** Calendar date as written on the page (YYYY-MM-DD), in the zone the page uses. Part of the upsert key. */
  date: string;
  /** UTC instant, ISO 8601 (e.g. 2026-08-15T14:00:00Z). null when the time is not known yet. */
  kickoffAt: string | null;
  /** True when the page has no usable start time (--:--, TBC, missing). */
  timeTbc: boolean;
  status: GameStatus;
  venue: string | null;
  broadcast: string | null;
  /** Nearest heading (level 2-3) or table section above the game; used to map a game to a league. */
  section: string | null;
}

export interface ParseContext {
  /** Season start year. Needed when dates are written without a year (AFL, CFB, NFL). */
  year?: number;
  /** When true, Jan-Jun dates belong to year + 1 (fall sports). */
  crossYear?: boolean;
  /** IANA zone used when a time carries no zone label. */
  tz?: string;
  /** Take the fallback zone from the home team (MLS). With no label and no home zone the time is TBC. */
  zoneFromHome?: boolean;
  homeTz?: (home: TeamRef) => string | null;
  /** The team a team-season page is about (CFB, CBB, NFL). */
  subject?: TeamRef;
}

export type ParserKind = 'football' | 'afl' | 'cfb' | 'cbb' | 'nfl' | 'gamelog' | 'cricket' | 'rugby';
