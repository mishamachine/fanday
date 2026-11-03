// Orchestration: work list -> fetch -> parse -> match teams -> match stored games -> plan -> one transaction.
// All I/O comes in through `Deps`, so Node tests run this with a fake database and a fake Wikipedia.
// Pure TypeScript, no Deno or Node APIs.
//
// Rules (review of PR #2):
//  * A stored game is matched by (league, home, away) within +-21 days of the incoming date; game_date is not in the match key,
//    so a moved date updates the row (and writes a game_date change) instead of creating a duplicate.
//  * Each game has one owning page (source_page + source_rank): the competition page if parsed, else the home club's page.
//    Other pages may only insert games the owner does not list yet. A higher-ranked page takes ownership.
//  * A kickoff, date, status or time_tbc change is held in games.pending and written (with its game_changes rows) only when the
//    same new value is seen again on a later run at least MIN_CONFIRM_MS later. Venue and broadcast changes apply at once.
//  * A future game its owner stops listing is set to 'postponed' (never deleted, logged) only after 2 runs AND 24 h since first missed.
//    If a page would lose more than max(3, 10% of its owned future games) in one run, the vanish step is skipped for it with a warning.
//  * Daily runs also roll a league to its next season when that season's pages exist, and look for the Wikipedia page of any team
//    whose page is missing, writing only leagues.season and teams.wiki_page.
//  * The whole batch (inserts, updates, game_changes) is one RPC call = one transaction.

import type { ParsedGame, TeamRef } from './types.ts';
import { parseWikitext } from './parse.ts';
import { canonicalInstant, collapseText, detectChanges, type FieldChange } from './detect.ts';
import { LEAGUE_SOURCES, leagueForSection, nextSeason, seasonContext, sourceFor } from './sources.ts';
import type { WikiPage } from './mediawiki.ts';

/** leagues.id is the slug ('epl', 'nfl', 'ncaaf'), as in the foundation schema. */
export interface LeagueRow { id: string; season: string | null }
export interface TeamRow { id: string; league_id: string; name: string; short_name: string | null; wiki_page: string | null; tz?: string | null }

export interface Pending {
  kickoff_at: string | null; time_tbc: boolean; game_date: string; status: string; seen_at: string;
}
export interface StoredGame {
  id: string; league_id: string; home_team_id: string; away_team_id: string; game_date: string;
  kickoff_at: string | null; time_tbc: boolean; status: string; venue: string | null; broadcast: string | null;
  source_page: string | null; source_rev: number | string | null;
  source_rank: number; pending: Pending | null; missing_runs: number; missing_since: string | null;
}

export const INSERT_COLUMNS = [
  'league_id', 'home_team_id', 'away_team_id', 'game_date', 'kickoff_at', 'time_tbc', 'status',
  'venue', 'broadcast', 'source_page', 'source_rev', 'source_rank',
] as const;
export const UPDATE_COLUMNS = [
  'id', 'game_date', 'kickoff_at', 'time_tbc', 'status', 'venue', 'broadcast', 'source_page', 'source_rev',
  'source_rank', 'pending', 'missing_runs', 'missing_since',
] as const;
/** Affiliate and sponsor columns: no code path here can name them. */
export const PROTECTED_COLUMNS = ['watch_provider', 'watch_url', 'tickets_url', 'sponsor_id', 'sponsor_text', 'sponsor_url'] as const;

export type GameInsert = Pick<StoredGame, (typeof INSERT_COLUMNS)[number]>;
export type GameUpdate = Pick<StoredGame, (typeof UPDATE_COLUMNS)[number]>;
export interface ChangeInsert { game_id: string; field: string; old_value: string | null; new_value: string | null; detected_at: string }
export interface ApplyOps { inserts: GameInsert[]; updates: GameUpdate[]; changes: ChangeInsert[] }

export interface Db {
  leagues(): Promise<LeagueRow[]>;
  teams(): Promise<TeamRow[]>;
  existingGames(leagueIds: string[], minDate: string, maxDate: string): Promise<StoredGame[]>;
  /** Games whose owning page is `title` and that are dated `fromDate` or later. */
  ownedFutureGames(title: string, fromDate: string): Promise<StoredGame[]>;
  /** One transaction: public.ingest_apply(inserts, updates, changes). */
  apply(ops: ApplyOps): Promise<void>;
  /** Is any game of the league still scheduled on or after `fromDate`? */
  hasFutureGames(leagueId: string, fromDate: string): Promise<boolean>;
  /** Season rollover: writes leagues.season and nothing else. */
  setLeagueSeason(leagueId: string, season: string): Promise<void>;
  /** Writes teams.wiki_page and nothing else. */
  setTeamWikiPage(teamId: string, wikiPage: string): Promise<void>;
  /** Games kicking off in [fromIso, toIso], or time-TBC games dated within that span. */
  gamesInWindow(fromIso: string, toIso: string): Promise<Array<{ source_page: string | null; home_team_id: string; away_team_id: string }>>;
}

export interface Deps {
  db: Db;
  fetchPages(titles: string[]): Promise<Map<string, WikiPage | null>>;
  /** Which Wikipedia titles exist (no content fetched). */
  pagesExist(titles: string[]): Promise<Map<string, boolean>>;
  now(): number;
  log?(msg: string): void;
}

export interface WorkItem {
  title: string; leagueSlug: string; teamId?: string; season: string;
  /** page: fetch and parse. rollover: is next season's page up? discover: find the page of a team that has none. Default page. */
  kind?: 'page' | 'rollover' | 'discover';
}

/** Rollover checks first, then every page, then teams with no wiki_page at all (daily mode runs all three). */
export function buildWorklist(leagues: LeagueRow[], teams: TeamRow[]): WorkItem[] {
  const pages: WorkItem[] = [];
  const rollovers: WorkItem[] = [];
  const discovers: WorkItem[] = [];
  const seen = new Set<string>();
  for (const src of LEAGUE_SOURCES) {
    const league = leagues.find((l) => l.id === src.slug);
    if (!league?.season) continue;
    rollovers.push({ title: `rollover:${src.slug}`, kind: 'rollover', leagueSlug: src.slug, season: league.season });
    const add = (title: string, t?: TeamRow) => {
      if (seen.has(title)) return;
      seen.add(title);
      pages.push({ title, kind: 'page', leagueSlug: src.slug, season: league.season!, teamId: t?.id });
    };
    if (src.mode === 'league') for (const title of src.title(league.season)) add(title);
    else {
      for (const t of teams.filter((x) => x.league_id === league.id).sort((a, b) => a.name.localeCompare(b.name))) {
        if (t.wiki_page) for (const title of src.title(league.season, t.wiki_page)) add(title, t);
        else discovers.push({ title: `discover:${t.id}`, kind: 'discover', leagueSlug: src.slug, teamId: t.id, season: league.season });
      }
    }
  }
  return [...rollovers, ...pages, ...discovers];
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

export function assertSafe(row: Record<string, unknown>, allowed: readonly string[]): void {
  for (const k of Object.keys(row)) {
    if ((PROTECTED_COLUMNS as readonly string[]).includes(k)) throw new Error(`ingest: protected column ${k}`);
    if (!allowed.includes(k)) throw new Error(`ingest: refusing to write column ${k}`);
  }
}

// ---------------------------------------------------------------- planning

export const WINDOW_DAYS = 21;
export const MIN_CONFIRM_MS = 30 * 60_000;
export const VANISH_RUNS = 2;
export const VANISH_MIN_MS = 24 * 3_600_000;
export const MASS_VANISH_MAX = 3;
export const MASS_VANISH_SHARE = 0.1;
const DAY = 86_400_000;

interface Incoming extends GameInsert { }
type Tuple = Pick<Pending, 'kickoff_at' | 'time_tbc' | 'game_date' | 'status'>;
const tupleOf = (g: { kickoff_at: string | null; time_tbc: boolean; game_date: string; status: string }): Tuple =>
  ({ kickoff_at: canonicalInstant(g.kickoff_at), time_tbc: !!g.time_tbc, game_date: g.game_date, status: g.status });
const sameTuple = (a: Tuple, b: Tuple) =>
  a.kickoff_at === b.kickoff_at && a.time_tbc === b.time_tbc && a.game_date === b.game_date && a.status === b.status;
const tripleKey = (g: { league_id: string; home_team_id: string; away_team_id: string }) => `${g.league_id}|${g.home_team_id}|${g.away_team_id}`;
const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;

/** Pair each incoming game with a stored one: exact date first, then the nearest date within WINDOW_DAYS. */
export function matchStored(incoming: Incoming[], stored: StoredGame[]): Map<Incoming, StoredGame> {
  const groups = new Map<string, StoredGame[]>();
  for (const s of stored) groups.set(tripleKey(s), [...(groups.get(tripleKey(s)) ?? []), s]);
  const used = new Set<string>(); // one stored row per incoming game from the same page
  const out = new Map<Incoming, StoredGame>();
  const take = (g: Incoming, s: StoredGame) => { used.add(`${g.source_page}|${s.id}`); out.set(g, s); };
  for (const g of incoming) {
    const s = (groups.get(tripleKey(g)) ?? []).find((x) => x.game_date === g.game_date && !used.has(`${g.source_page}|${x.id}`));
    if (s) take(g, s);
  }
  for (const g of incoming) {
    if (out.has(g)) continue;
    let best: StoredGame | undefined;
    for (const x of groups.get(tripleKey(g)) ?? []) {
      if (used.has(`${g.source_page}|${x.id}`)) continue;
      const d = daysApart(x.game_date, g.game_date);
      if (d <= WINDOW_DAYS && (!best || d < daysApart(best.game_date, g.game_date))) best = x;
    }
    if (best) take(g, best);
  }
  return out;
}

const asChange = (game_id: string, c: FieldChange, detected_at: string): ChangeInsert => ({ game_id, ...c, detected_at });

/** What to do with a stored game the owning page lists again. Returns null when nothing needs writing. */
export function planUpdate(
  e: StoredGame, inc: Incoming, nowMs: number, stored: StoredGame[],
): { update: GameUpdate; changes: ChangeInsert[]; held: boolean } | null {
  const stamp = new Date(nowMs).toISOString();
  const cur = tupleOf(e);
  const want = tupleOf(inc);
  const changes: ChangeInsert[] = [];
  let pending: Pending | null = e.pending ?? null;
  let next = { game_date: e.game_date, kickoff_at: e.kickoff_at, time_tbc: e.time_tbc, status: e.status };
  let held = false;

  if (sameTuple(cur, want)) pending = null;
  else if (pending && sameTuple(tupleOf(pending), want)) {
    const clash = want.game_date !== e.game_date &&
      stored.some((s) => s.id !== e.id && tripleKey(s) === tripleKey(e) && s.game_date === want.game_date);
    if (nowMs - Date.parse(pending.seen_at) >= MIN_CONFIRM_MS && !clash) {
      const before = { ...cur, venue: null }, after = { ...want, venue: null };
      for (const c of detectChanges(before, after)) changes.push(asChange(e.id, c, stamp));
      next = { game_date: want.game_date, kickoff_at: inc.kickoff_at, time_tbc: inc.time_tbc, status: inc.status };
      pending = null;
    } else held = true;
  } else {
    pending = { ...want, seen_at: stamp };
    held = true;
  }

  if (collapseText(e.venue) !== collapseText(inc.venue)) {
    changes.push({ game_id: e.id, field: 'venue', old_value: collapseText(e.venue), new_value: collapseText(inc.venue), detected_at: stamp });
  }
  const broadcast = inc.broadcast ?? e.broadcast; // a missing TV column never erases a stored note
  const dirty = changes.length > 0 || JSON.stringify(pending) !== JSON.stringify(e.pending ?? null) ||
    collapseText(broadcast) !== collapseText(e.broadcast) || e.source_page !== inc.source_page ||
    e.source_rank !== inc.source_rank || e.missing_runs !== 0 || e.missing_since != null;
  if (!dirty) return null;
  return {
    changes, held,
    update: {
      id: e.id, ...next, venue: inc.venue, broadcast, source_page: inc.source_page, source_rev: inc.source_rev,
      source_rank: inc.source_rank, pending, missing_runs: 0, missing_since: null,
    },
  };
}

// ---------------------------------------------------------------- batch

export interface BatchStats {
  pagesFetched: number; pagesMissing: string[]; gamesParsed: number; gamesDropped: number;
  created: number; updated: number; held: number; changes: number; vanished: number; unmatchedTeams: string[];
  warnings: string[]; rolled: string[]; pagesFilled: string[];
}
const emptyStats = (): BatchStats => ({ pagesFetched: 0, pagesMissing: [], gamesParsed: 0, gamesDropped: 0, created: 0, updated: 0, held: 0, changes: 0, vanished: 0, unmatchedTeams: [], warnings: [], rolled: [], pagesFilled: [] });

export async function processBatch(items: WorkItem[], deps: Deps, ref: { leagues: LeagueRow[]; teams: TeamRow[] }): Promise<BatchStats> {
  const stats = emptyStats();
  await maintain(items.filter((i) => i.kind === 'rollover' || i.kind === 'discover'), deps, ref, stats);
  items = items.filter((i) => (i.kind ?? 'page') === 'page');
  if (items.length === 0) return stats;
  const idx = indexTeams(ref.teams);
  const pages = await deps.fetchPages(items.map((i) => i.title));
  const unmatched = new Set<string>();
  const nowMs = deps.now();
  const stamp = new Date(nowMs).toISOString();
  const today = stamp.slice(0, 10);
  const incoming = new Map<string, Incoming>(); // same triple + date from several pages: highest rank wins
  const parsedPages: Array<{ title: string; clean: boolean }> = [];

  for (const item of items) {
    const page = pages.get(item.title);
    if (!page) {
      stats.pagesMissing.push(item.title);
      if (item.teamId) await discoverPage(item, deps, ref, stats); // the page may live under another name
      continue;
    }
    stats.pagesFetched++;
    const src = sourceFor(item.leagueSlug)!;
    const team = item.teamId ? ref.teams.find((t) => t.id === item.teamId) : undefined;
    const games: ParsedGame[] = parseWikitext(src.kind, page.wikitext, {
      ...seasonContext(item.season), tz: src.tz, zoneFromHome: src.zoneFromHome, zoneAliases: src.zoneAliases,
      homeTz: (r) => { const id = resolveTeam(idx, r, item.leagueSlug); return ref.teams.find((t) => t.id === id)?.tz ?? null; },
      subject: team ? { name: team.name, page: team.wiki_page } : undefined,
    });
    stats.gamesParsed += games.length;
    let dropped = 0;
    for (const g of games) {
      const slug = leagueForSection(src, g.section);
      const league = slug ? ref.leagues.find((l) => l.id === slug) : undefined;
      if (!league) continue; // a competition we do not carry
      const home = resolveTeam(idx, g.home, league.id);
      const away = resolveTeam(idx, g.away, league.id);
      if (!home || !away || home === away) {
        for (const [r, id] of [[g.home, home], [g.away, away]] as const) if (!id) unmatched.add(`${league.id}:${r.name}`);
        dropped++;
        continue;
      }
      const row: Incoming = {
        league_id: league.id, home_team_id: home, away_team_id: away, game_date: g.date,
        kickoff_at: g.kickoffAt, time_tbc: g.timeTbc, status: g.status, venue: g.venue, broadcast: g.broadcast,
        source_page: page.title, source_rev: page.revid,
        source_rank: src.mode === 'league' ? 2 : item.teamId === home ? 1 : 0,
      };
      const k = `${tripleKey(row)}|${row.game_date}`;
      const prev = incoming.get(k);
      if (!prev || row.source_rank > prev.source_rank) incoming.set(k, row);
    }
    stats.gamesDropped += dropped;
    parsedPages.push({ title: page.title, clean: dropped === 0 && games.length > 0 });
  }
  stats.unmatchedTeams = [...unmatched].sort();

  const rows = [...incoming.values()].sort((a, b) => b.source_rank - a.source_rank);
  const ops: ApplyOps = { inserts: [], updates: [], changes: [] };
  const touched = new Set<string>();
  const seenBy = new Map<string, Set<string>>();

  if (rows.length) {
    const dates = rows.map((r) => r.game_date).sort();
    const lo = new Date(Date.parse(dates[0]) - WINDOW_DAYS * DAY).toISOString().slice(0, 10);
    const hi = new Date(Date.parse(dates[dates.length - 1]) + WINDOW_DAYS * DAY).toISOString().slice(0, 10);
    const stored = await deps.db.existingGames([...new Set(rows.map((r) => r.league_id))], lo, hi);
    const matched = matchStored(rows, stored);
    for (const row of rows) {
      const e = matched.get(row);
      if (!e) { ops.inserts.push({ ...row }); stats.created++; continue; }
      if (e.source_page !== row.source_page && row.source_rank <= e.source_rank) continue; // not the owner: never overwrites
      if (touched.has(e.id)) continue;
      touched.add(e.id);
      if (!seenBy.has(row.source_page!)) seenBy.set(row.source_page!, new Set());
      seenBy.get(row.source_page!)!.add(e.id);
      const plan = planUpdate(e, row, nowMs, stored);
      if (!plan) continue;
      ops.updates.push(plan.update);
      ops.changes.push(...plan.changes);
      if (plan.held) stats.held++;
    }
  }

  // Games an owning page has stopped listing. Marked postponed (never deleted) only after VANISH_RUNS runs AND VANISH_MIN_MS
  // since first missed. A page about to lose too many games at once is probably broken or vandalised: skip it and warn.
  for (const p of parsedPages) {
    if (!p.clean) continue; // a page that parsed to nothing, or lost games to unknown teams, proves nothing
    const owned = await deps.db.ownedFutureGames(p.title, today);
    const missing = owned.filter((e) => !touched.has(e.id) && !seenBy.get(p.title)?.has(e.id) && e.status === 'scheduled');
    if (!missing.length) continue;
    if (missing.length > Math.max(MASS_VANISH_MAX, owned.length * MASS_VANISH_SHARE)) {
      const msg = `mass vanish skipped for "${p.title}": ${missing.length} of ${owned.length} future games missing`;
      stats.warnings.push(msg);
      deps.log?.(`warning: ${msg}`);
      continue;
    }
    for (const e of missing) {
      touched.add(e.id);
      const since = e.missing_since ?? stamp;
      const runs = e.missing_runs + 1;
      const gone = runs >= VANISH_RUNS && nowMs - Date.parse(since) >= VANISH_MIN_MS;
      ops.updates.push({
        id: e.id, game_date: e.game_date, kickoff_at: e.kickoff_at, time_tbc: e.time_tbc, status: gone ? 'postponed' : e.status,
        venue: e.venue, broadcast: e.broadcast, source_page: e.source_page, source_rev: e.source_rev, source_rank: e.source_rank,
        pending: e.pending, missing_runs: runs, missing_since: since,
      });
      if (gone) {
        ops.changes.push({ game_id: e.id, field: 'status', old_value: e.status, new_value: 'postponed', detected_at: stamp });
        stats.vanished++;
      }
    }
  }

  for (const r of ops.inserts) assertSafe(r, INSERT_COLUMNS);
  for (const r of ops.updates) assertSafe(r, UPDATE_COLUMNS);
  if (ops.inserts.length || ops.updates.length || ops.changes.length) await deps.db.apply(ops);
  stats.updated = ops.updates.length;
  stats.changes = ops.changes.length;
  return stats;
}

// ---------------------------------------------------------------- season rollover and page discovery

/** Candidate Wikipedia article names for a team, current wiki_page first. */
export function pageCandidates(t: TeamRow): string[] {
  return [...new Set([t.wiki_page, t.name, `${t.name} F.C.`, `${t.name} FC`, `Club ${t.name}`].filter((x): x is string => !!x))];
}

/** A replacement name must still be about the same team: its key contains the team's own name key. */
export function acceptableCandidate(t: Pick<TeamRow, 'name'>, candidate: string): boolean {
  const own = teamKey(t.name);
  return own !== '' && teamKey(candidate).includes(own);
}

/**
 * Fill teams.wiki_page when it is empty or its season page no longer exists, under a candidate name for the same team.
 * A page that exists (this season or the next) is never replaced. Writes teams.wiki_page only.
 */
async function discoverPage(item: WorkItem, deps: Deps, ref: { leagues: LeagueRow[]; teams: TeamRow[] }, stats: BatchStats): Promise<void> {
  const src = sourceFor(item.leagueSlug);
  const team = ref.teams.find((t) => t.id === item.teamId);
  const league = ref.leagues.find((l) => l.id === item.leagueSlug);
  if (!src || !team || !league?.season) return;
  const next = nextSeason(league.season);
  const current = team.wiki_page ? [src.title(league.season, team.wiki_page)[0], ...(next ? [src.title(next, team.wiki_page)[0]] : [])] : [];
  const names = pageCandidates(team).filter((n) => n !== team.wiki_page && acceptableCandidate(team, n));
  const titles = names.map((n) => src.title(league.season!, n)[0]);
  const found = await deps.pagesExist([...current, ...titles]);
  if (current.some((t) => found.get(t))) return; // the page exists (or next season's does): keep it
  const hit = names.findIndex((_, i) => found.get(titles[i]));
  if (hit < 0) return;
  await deps.db.setTeamWikiPage(team.id, names[hit]);
  stats.pagesFilled.push(`${team.id}: ${names[hit]}`);
  team.wiki_page = names[hit];
}

async function maintain(items: WorkItem[], deps: Deps, ref: { leagues: LeagueRow[]; teams: TeamRow[] }, stats: BatchStats): Promise<void> {
  const today = new Date(deps.now()).toISOString().slice(0, 10);
  for (const item of items) {
    if (item.kind === 'discover') { await discoverPage(item, deps, ref, stats); continue; }
    const src = sourceFor(item.leagueSlug);
    const league = ref.leagues.find((l) => l.id === item.leagueSlug);
    const next = league?.season ? nextSeason(league.season) : null;
    if (!src || !league || !next) continue;
    const titles = src.mode === 'league'
      ? src.title(next)
      : ref.teams.filter((t) => t.league_id === league.id && t.wiki_page).flatMap((t) => src.title(next, t.wiki_page!));
    if (!titles.length) continue;
    const found = [...(await deps.pagesExist(titles)).values()].filter(Boolean).length;
    // A league page must be up; for team pages, at least half of the teams (the rest stay "Schedule coming").
    const ready = src.mode === 'league' ? found === titles.length : found * 2 >= titles.length;
    if (!ready || found === 0) continue;
    if (await deps.db.hasFutureGames(league.id, today)) continue; // the current season is still being played
    const prev = league.season;
    await deps.db.setLeagueSeason(league.id, next);
    stats.rolled.push(`${league.id}: ${prev} -> ${next}`);
    league.season = next;
  }
}

// ---------------------------------------------------------------- run

export type Mode = 'daily' | 'gameday';
export interface RunRequest { mode: Mode; cursor?: number; league?: string }
export interface RunSummary extends BatchStats { mode: Mode; planned: number; cursor: number; nextCursor: number | null; done: boolean; elapsedMs: number }

/** Supabase Edge Functions allow 2 s of CPU per request (docs, seen 2026-11-03). Parsing a page takes tens of
 *  milliseconds, so two pages per call leaves a wide margin; the workflow loops on nextCursor. */
export const PAGES_PER_CALL = 2;
export const GAMEDAY_WINDOW_MS = 36 * 3600_000;

export async function runIngest(req: RunRequest, deps: Deps): Promise<RunSummary> {
  const started = deps.now();
  const [leagues, teams] = await Promise.all([deps.db.leagues(), deps.db.teams()]);
  let work = buildWorklist(leagues, teams);
  if (req.league) work = work.filter((w) => w.leagueSlug === req.league);
  if (req.mode === 'gameday') {
    const games = await deps.db.gamesInWindow(new Date(started).toISOString(), new Date(started + GAMEDAY_WINDOW_MS).toISOString());
    const pages = new Set(games.map((g) => g.source_page));
    const teamIds = new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]));
    // A game is on the league page and on both clubs' season pages: refresh all of them.
    work = work.filter((w) => (w.kind ?? 'page') === 'page' && (pages.has(w.title) || (w.teamId !== undefined && teamIds.has(w.teamId))));
  }
  const start = Math.max(0, req.cursor ?? 0);
  const stats = start < work.length ? await processBatch(work.slice(start, start + PAGES_PER_CALL), deps, { leagues, teams }) : emptyStats();
  const end = start + PAGES_PER_CALL;
  const done = end >= work.length;
  return { ...stats, mode: req.mode, planned: work.length, cursor: start, nextCursor: done ? null : end, done, elapsedMs: deps.now() - started };
}
