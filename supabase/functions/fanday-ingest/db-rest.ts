// Supabase PostgREST client over plain fetch (no supabase-js dependency).
// Called with the service-role key from the function's environment; the key never leaves this module.

import type { ApplyOps, Db, LeagueRow, StoredGame, TeamRow } from './ingest.ts';

const PAGE = 1000;

export function createRestDb(baseUrl: string, serviceKey: string, fetchImpl: typeof fetch = fetch): Db {
  const rest = `${baseUrl.replace(/\/$/, '')}/rest/v1`;
  const headers = (extra: Record<string, string> = {}) => ({
    apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json',
    // Shared project: every table and RPC lives in the `fanday` schema, selected per request (Accept-Profile for reads, Content-Profile for writes).
    'Accept-Profile': 'fanday', 'Content-Profile': 'fanday', ...extra,
  });

  async function get<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const res = await fetchImpl(`${rest}/${path}${path.includes('?') ? '&' : '?'}limit=${PAGE}&offset=${offset}`, { headers: headers() });
      if (!res.ok) throw new Error(`Supabase GET ${path.split('?')[0]} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const rows = (await res.json()) as T[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  async function post(path: string, body: unknown): Promise<void> {
    const res = await fetchImpl(`${rest}/${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Supabase POST ${path.split('?')[0]} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  return {
    leagues: () => get<LeagueRow>('leagues?select=id,season&order=id'),
    teams: () => get<TeamRow>('teams?select=id,league_id,name,short_name,wiki_page,tz&order=id'),
    existingGames: (leagueIds, minDate, maxDate) =>
      get<StoredGame>(
        `games?select=id,league_id,home_team_id,away_team_id,game_date,kickoff_at,time_tbc,status,venue,broadcast,source_page,source_rev,source_rank,pending,missing_runs,missing_since` +
          `&league_id=in.(${leagueIds.join(',')})&game_date=gte.${minDate}&game_date=lte.${maxDate}&order=id`,
      ),
    ownedFutureGames: (title, fromDate) =>
      get<StoredGame>(`games?select=id,league_id,home_team_id,away_team_id,game_date,kickoff_at,time_tbc,status,venue,broadcast,source_page,source_rev,source_rank,pending,missing_runs,missing_since&source_page=eq.${encodeURIComponent(title)}&game_date=gte.${fromDate}&order=id`),
    async hasFutureGames(leagueId, fromDate) {
      const res = await fetchImpl(`${rest}/games?select=id&league_id=eq.${encodeURIComponent(leagueId)}&status=eq.scheduled&game_date=gte.${fromDate}&limit=1`, { headers: headers() });
      if (!res.ok) throw new Error(`Supabase GET games failed: ${res.status}`);
      return ((await res.json()) as unknown[]).length > 0;
    },
    setLeagueSeason: (leagueId, season) => post('rpc/ingest_set_league_season', { p_league_id: leagueId, p_season: season }),
    setTeamWikiPage: (teamId, wikiPage) => post('rpc/ingest_set_team_wiki_page', { p_team_id: teamId, p_wiki_page: wikiPage }),
    // One transaction in the database; the function can change only the columns it lists (migration 0002).
    apply: (ops: ApplyOps) => post('rpc/ingest_apply', { p_inserts: ops.inserts, p_updates: ops.updates, p_changes: ops.changes }),
    gamesInWindow: (fromIso, toIso) =>
      get<{ source_page: string | null; home_team_id: string; away_team_id: string }>(
        `games?select=source_page,home_team_id,away_team_id` +
          `&or=(and(kickoff_at.gte.${fromIso},kickoff_at.lte.${toIso}),and(time_tbc.is.true,game_date.gte.${fromIso.slice(0, 10)},game_date.lte.${toIso.slice(0, 10)}))&order=id`,
      ),
  };
}
