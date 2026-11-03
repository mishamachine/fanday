// Orchestration: work list -> fetch -> parse -> match teams -> diff -> upsert + game_changes.
// All I/O comes in through `Deps`, so Node tests run this with a fake database and a fake Wikipedia.
// Pure TypeScript, no Deno or Node APIs.

import type { ParsedGame, TeamRef } from './types.ts';
import { parseWikitext } from './parse.ts';
import { detectChanges, needsUpdate, type ChangeField } from './detect.ts';
import { LEAGUE_SOURCES, leagueForSection, seasonContext, sourceFor } from './sources.ts';
import type { WikiPage } from './mediawiki.ts';

/** leagues.id is the slug ('epl', 'nfl', 'ncaaf'), as in the foundation schema. */
export interface LeagueRow { id: string; season: string | null }
export interface TeamRow { id: string; league_id: string; name: string; short_name: string | null; wiki_page: string | null }
export interface StoredGame {
  id: string; league_id: string; home_team_id: string; away_team_id: string; game_date: string;
  kickoff_at: string | null; time_tbc: boolean; status: string; venue: string | null; broadcast: string | null;
  source_page: string | null; source_rev: number | string | null;
}

/** Exactly the columns the ingest may write. Affiliate and sponsor columns are not here and never will be. */
export const UPSERT_COLUMNS = [
  'league_id', 'home_team_id', 'away_team_id', 'game_date', 'kickoff_at', 'time_tbc', 'status',
  'venue', 'broadcast', 'source_page', 'source_rev', 'updated_at',
] as const;
export const CONFLICT_KEY = ['league_id', 'home_team_id', 'away_team_id', 'game_date'] as const;
export const PROTECTED_COLUMNS = ['watch_provider', 'watch_url', 'tickets_url', 'sponsor_id', 'sponsor_text', 'sponsor_url'] as const;

export type GameUpsert = Omit<Pick<StoredGame, Exclude<(typeof UPSERT_COLUMNS)[number], 'updated_at'>>, never> & { updated_at: string };
export interface ChangeInsert { game_id: string; field: ChangeField; old_value: string | null; new_value: string | null; detected_at: string }

export interface Db {
  leagues(): Promise<LeagueRow[]>;
  teams(): Promise<TeamRow[]>;
  existingGames(leagueIds: string[], minDate: string, maxDate: string): Promise<StoredGame[]>;
  upsertGames(rows: GameUpsert[]): Promise<void>;
  insertChanges(rows: ChangeInsert[]): Promise<void>;
  /** Games kicking off in [fromIso, toIso], or time-TBC games dated within that span. */
  gamesInWindow(fromIso: string, toIso: string): Promise<Array<{ source_page: string | null; home_team_id: string; away_team_id: string }>>;
}

export interface Deps {
  db: Db;
  fetchPages(titles: string[]): Promise<Map<string, WikiPage | null>>;
  now(): number;
  log?(msg: string): void;
}

export interface WorkItem { title: string; leagueSlug: string; teamId?: string; season: string }

export function buildWorklist(leagues: LeagueRow[], teams: TeamRow[]): WorkItem[] {
  const out: WorkItem[] = [];
  const seen = new Set<string>();
  for (const src of LEAGUE_SOURCES) {
    const league = leagues.find((l) => l.id === src.slug);
    if (!league?.season) continue;
    const add = (title: string, t?: TeamRow) => {
      if (seen.has(title)) return;
      seen.add(title);
      out.push({ title, leagueSlug: src.slug, season: league.season!, teamId: t?.id });
    };
    if (src.mode === 'league') for (const title of src.title(league.season)) add(title);
    else {
      for (const t of teams.filter((x) => x.league_id === league.id && x.wiki_page).sort((a, b) => a.name.localeCompare(b.name))) {
        for (const title of src.title(league.season, t.wiki_page!)) add(title, t);
      }
    }
  }
  return out;
}

/** Lower case, no accents, no dots/punctuation, without FC/AFC/CF tokens: "Arsenal F.C." and "Arsenal" match. */
export function teamKey(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\./g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && w !== 'fc' && w !== 'afc' && w !== 'cf').join(' ');
}

export function indexTeams(teams: TeamRow[]): Map<string, TeamRow[]> {
  const m = new Map<string, TeamRow[]>();
  for (const t of teams) {
    for (const k of new Set([t.wiki_page, t.name, t.short_name].filter(Boolean).map((x) => teamKey(x!)))) {
      m.set(k, [...(m.get(k) ?? []), t]);
    }
  }
  return m;
}

/** Team id for a team reference: page link first, then name. Prefers a team in the game's league. */
export function resolveTeam(idx: Map<string, TeamRow[]>, ref: TeamRef, leagueId: string): string | null {
  for (const key of [ref.page ? teamKey(ref.page) : '', teamKey(ref.name)]) {
    const c = key ? idx.get(key) : undefined;
    if (!c?.length) continue;
    const same = c.find((t) => t.league_id === leagueId);
    if (same) return same.id;
    if (new Set(c.map((t) => t.id)).size === 1) return c[0].id;
  }
  return null;
}

export const gameKey = (g: { league_id: string; home_team_id: string; away_team_id: string; game_date: string }) =>
  `${g.league_id}|${g.home_team_id}|${g.away_team_id}|${g.game_date}`;

export function assertSafeRow(row: Record<string, unknown>): void {
  for (const k of Object.keys(row)) {
    if (!(UPSERT_COLUMNS as readonly string[]).includes(k)) throw new Error(`ingest: refusing to write column ${k}`);
    if ((PROTECTED_COLUMNS as readonly string[]).includes(k)) throw new Error(`ingest: protected column ${k}`);
  }
}

export interface BatchStats {
  pagesFetched: number; pagesMissing: string[]; gamesParsed: number; gamesDropped: number;
  upserted: number; created: number; changes: number; unmatchedTeams: string[];
}
const emptyStats = (): BatchStats => ({ pagesFetched: 0, pagesMissing: [], gamesParsed: 0, gamesDropped: 0, upserted: 0, created: 0, changes: 0, unmatchedTeams: [] });

export async function processBatch(items: WorkItem[], deps: Deps, ref: { leagues: LeagueRow[]; teams: TeamRow[] }): Promise<BatchStats> {
  const stats = emptyStats();
  const idx = indexTeams(ref.teams);
  const pages = await deps.fetchPages(items.map((i) => i.title));
  const incoming = new Map<string, GameUpsert>();
  const unmatched = new Set<string>();
  const stamp = new Date(deps.now()).toISOString();

  for (const item of items) {
    const page = pages.get(item.title);
    if (!page) { stats.pagesMissing.push(item.title); continue; }
    stats.pagesFetched++;
    const src = sourceFor(item.leagueSlug)!;
    const team = item.teamId ? ref.teams.find((t) => t.id === item.teamId) : undefined;
    const games: ParsedGame[] = parseWikitext(src.kind, page.wikitext, {
      ...seasonContext(item.season), tz: src.tz, subject: team ? { name: team.name, page: team.wiki_page } : undefined,
    });
    stats.gamesParsed += games.length;
    for (const g of games) {
      const slug = leagueForSection(src, g.section);
      const league = slug ? ref.leagues.find((l) => l.id === slug) : undefined;
      if (!league) { stats.gamesDropped++; continue; }
      const home = resolveTeam(idx, g.home, league.id);
      const away = resolveTeam(idx, g.away, league.id);
      if (!home || !away || home === away) {
        for (const [r, id] of [[g.home, home], [g.away, away]] as const) if (!id) unmatched.add(`${league.id}:${r.name}`);
        stats.gamesDropped++;
        continue;
      }
      const row: GameUpsert = {
        league_id: league.id, home_team_id: home, away_team_id: away, game_date: g.date,
        kickoff_at: g.kickoffAt, time_tbc: g.timeTbc, status: g.status, venue: g.venue, broadcast: g.broadcast,
        source_page: page.title, source_rev: page.revid, updated_at: stamp,
      };
      incoming.set(gameKey(row), row); // same game on two pages: last one wins, and avoids a double-hit upsert
    }
  }
  stats.unmatchedTeams = [...unmatched].sort();
  if (incoming.size === 0) return stats;

  const rows = [...incoming.values()];
  const dates = rows.map((r) => r.game_date).sort();
  const stored = await deps.db.existingGames([...new Set(rows.map((r) => r.league_id))], dates[0], dates[dates.length - 1]);
  const byKey = new Map(stored.map((s) => [gameKey(s), s]));

  const toWrite: GameUpsert[] = [];
  const changes: ChangeInsert[] = [];
  for (const row of rows) {
    const old = byKey.get(gameKey(row));
    if (!old) { toWrite.push(row); stats.created++; continue; }
    if (!needsUpdate(old, row)) continue; // identical, or only source_rev / whitespace moved
    for (const c of detectChanges(old, row)) changes.push({ game_id: old.id, ...c, detected_at: stamp });
    // Keep a stored TV note when Wikipedia has none, so a missing column never erases it.
    toWrite.push({ ...row, broadcast: row.broadcast ?? old.broadcast });
  }
  for (const r of toWrite) assertSafeRow(r);
  for (let i = 0; i < toWrite.length; i += 200) await deps.db.upsertGames(toWrite.slice(i, i + 200));
  if (changes.length) await deps.db.insertChanges(changes);
  stats.upserted = toWrite.length;
  stats.changes = changes.length;
  return stats;
}

export type Mode = 'daily' | 'gameday';
export interface RunRequest { mode: Mode; cursor?: number; league?: string }
export interface RunSummary extends BatchStats { mode: Mode; planned: number; cursor: number; nextCursor: number | null; done: boolean; elapsedMs: number }

export const BATCH_SIZE = 10;
export const BUDGET_MS = 100_000;
export const GAMEDAY_WINDOW_MS = 36 * 3600_000;

export async function runIngest(req: RunRequest, deps: Deps, budgetMs = BUDGET_MS): Promise<RunSummary> {
  const started = deps.now();
  const [leagues, teams] = await Promise.all([deps.db.leagues(), deps.db.teams()]);
  let work = buildWorklist(leagues, teams);
  if (req.league) work = work.filter((w) => w.leagueSlug === req.league);
  if (req.mode === 'gameday') {
    const games = await deps.db.gamesInWindow(new Date(started).toISOString(), new Date(started + GAMEDAY_WINDOW_MS).toISOString());
    const pages = new Set(games.map((g) => g.source_page));
    const teamIds = new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]));
    // A game is on the league page and on both clubs' season pages: refresh all of them.
    work = work.filter((w) => pages.has(w.title) || (w.teamId !== undefined && teamIds.has(w.teamId)));
  }
  const total = emptyStats();
  const start = Math.max(0, req.cursor ?? 0);
  let i = start;
  while (i < work.length && (i === start || deps.now() - started < budgetMs)) {
    const s = await processBatch(work.slice(i, i + BATCH_SIZE), deps, { leagues, teams });
    i += BATCH_SIZE;
    for (const k of ['pagesFetched', 'gamesParsed', 'gamesDropped', 'upserted', 'created', 'changes'] as const) total[k] += s[k];
    total.pagesMissing.push(...s.pagesMissing);
    total.unmatchedTeams = [...new Set([...total.unmatchedTeams, ...s.unmatchedTeams])];
  }
  const done = i >= work.length;
  return { ...total, mode: req.mode, planned: work.length, cursor: start, nextCursor: done ? null : i, done, elapsedMs: deps.now() - started };
}
