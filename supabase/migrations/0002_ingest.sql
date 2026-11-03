-- Fanday 0002: support for the Wikipedia ingest (PR cto/fanday-ingest). Applies on top of 0001_init.sql.
-- Not applied to any remote project by the PR; ships as a file.

-- One owning page per game; other pages may only insert games the owner does not list yet.
--   source_rank   2 = competition page (UCL, AFL, IPL, NRL), 1 = the home club's own page, 0 = any other page
--   pending       a kickoff / date / status change seen once, held until the same value is seen on a later run
--   missing_runs  consecutive runs in which the owning page no longer listed this future game
alter table public.games
  add column if not exists source_rank  smallint not null default 0,
  add column if not exists pending      jsonb,
  add column if not exists missing_runs smallint not null default 0;

-- Local zone of the home team (IANA name), used for times a page gives with no zone label (MLS). Null = unknown, time stays TBC.
alter table public.teams add column if not exists tz text;

create index if not exists games_source_page_idx on public.games (source_page);

-- Applies one ingest batch (new games, updates to existing games, game_changes rows) in a single transaction.
-- Only the listed columns can change; affiliate and sponsor columns are not reachable from here.
create or replace function public.ingest_apply(p_inserts jsonb, p_updates jsonb, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_ins int := 0;
  n_upd int := 0;
  n_chg int := 0;
begin
  insert into public.games (league_id, home_team_id, away_team_id, game_date, kickoff_at, time_tbc, status,
                            venue, broadcast, source_page, source_rev, source_rank)
  select x.league_id, x.home_team_id, x.away_team_id, x.game_date, x.kickoff_at, coalesce(x.time_tbc, false),
         coalesce(x.status, 'scheduled'), x.venue, x.broadcast, x.source_page, x.source_rev, coalesce(x.source_rank, 0)
  from jsonb_to_recordset(coalesce(p_inserts, '[]'::jsonb)) as x(
         league_id text, home_team_id text, away_team_id text, game_date date, kickoff_at timestamptz,
         time_tbc boolean, status text, venue text, broadcast text, source_page text, source_rev bigint, source_rank smallint)
  on conflict (league_id, home_team_id, away_team_id, game_date) do nothing;
  get diagnostics n_ins = row_count;

  update public.games g
     set game_date    = x.game_date,
         kickoff_at   = x.kickoff_at,
         time_tbc     = coalesce(x.time_tbc, false),
         status       = coalesce(x.status, 'scheduled'),
         venue        = x.venue,
         broadcast    = x.broadcast,
         source_page  = x.source_page,
         source_rev   = x.source_rev,
         source_rank  = coalesce(x.source_rank, 0),
         pending      = nullif(x.pending, 'null'::jsonb),
         missing_runs = coalesce(x.missing_runs, 0),
         updated_at   = now()
    from jsonb_to_recordset(coalesce(p_updates, '[]'::jsonb)) as x(
           id uuid, game_date date, kickoff_at timestamptz, time_tbc boolean, status text, venue text, broadcast text,
           source_page text, source_rev bigint, source_rank smallint, pending jsonb, missing_runs smallint)
   where g.id = x.id;
  get diagnostics n_upd = row_count;

  insert into public.game_changes (game_id, field, old_value, new_value, detected_at)
  select x.game_id, x.field, x.old_value, x.new_value, coalesce(x.detected_at, now())
  from jsonb_to_recordset(coalesce(p_changes, '[]'::jsonb)) as x(
         game_id uuid, field text, old_value text, new_value text, detected_at timestamptz);
  get diagnostics n_chg = row_count;

  return jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'changes', n_chg);
end;
$$;

revoke all on function public.ingest_apply(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_apply(jsonb, jsonb, jsonb) to service_role;
