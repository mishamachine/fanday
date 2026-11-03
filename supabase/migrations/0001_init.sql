-- Fanday v1 schema (build-plan.md data model, 2026-11-02). RLS on every table.
-- Auth model: anonymous users are real auth users with the `authenticated` role, so user-owned rows key to auth.uid().
-- Reference tables (leagues, teams, games, game_changes, sponsors): readable by anon + authenticated, written by service_role only.
-- Not applied to any remote project by this PR; ships as a file.

-- ---------------------------------------------------------------- reference tables
create table public.leagues (
  id           text primary key,                       -- slug, e.g. 'nfl'
  name         text not null,
  country      text not null,                          -- display name, e.g. 'England'
  country_code text not null,                          -- ISO-3166 alpha-2 (or 'EU'); drives 12h/24h display
  sport        text not null,
  season       text,
  source       text not null check (source in ('wikipedia', 'official_link')),
  tz           text,
  in_season    boolean not null default true,
  sort         int not null default 0
);

create table public.teams (
  id                    text primary key,              -- slug, e.g. 'nfl-kc'
  league_id             text not null references public.leagues (id) on delete cascade,
  name                  text not null,
  short_name            text not null,                 -- neutral text badge ('KC'); never a logo
  wiki_page             text,
  official_calendar_url text
);
create index teams_league_idx on public.teams (league_id);

create table public.sponsors (
  id            uuid primary key default gen_random_uuid(),
  scope_type    text not null check (scope_type in ('league', 'team', 'country', 'city')),
  scope_value   text not null,
  starts_on     date,
  ends_on       date,
  text          text not null,
  url           text,
  push_eligible boolean not null default false
);

create table public.games (
  id            uuid primary key default gen_random_uuid(),
  league_id     text not null references public.leagues (id) on delete cascade,
  home_team_id  text not null references public.teams (id) on delete cascade,
  away_team_id  text not null references public.teams (id) on delete cascade,
  game_date     date not null,                         -- part of the ingest key; set even when the time is TBC
  kickoff_at    timestamptz,                           -- null while the time is not published
  time_tbc      boolean not null default false,
  status        text not null default 'scheduled' check (status in ('scheduled', 'postponed', 'cancelled', 'final')),
  venue         text,
  broadcast     text,
  country       text,                                  -- optional override of leagues.country_code for time format
  source_page   text,
  source_rev    bigint,                                -- Wikipedia revision id
  updated_at    timestamptz not null default now(),
  -- affiliate / sponsor fields (monetization-plan.md, "What the CTO should reserve"). Server-filled; empty for now.
  watch_provider text,
  watch_url      text,
  tickets_url    text,
  sponsor_id     uuid references public.sponsors (id) on delete set null,
  sponsor_text   text,
  sponsor_url    text,
  unique (league_id, home_team_id, away_team_id, game_date)
);
create index games_home_idx on public.games (home_team_id, game_date);
create index games_away_idx on public.games (away_team_id, game_date);

create table public.game_changes (
  id          bigint generated always as identity primary key,
  game_id     uuid not null references public.games (id) on delete cascade,
  field       text not null,
  old_value   text,
  new_value   text,
  detected_at timestamptz not null default now(),
  pushed_at   timestamptz
);
create index game_changes_game_idx on public.game_changes (game_id, detected_at desc);

-- ---------------------------------------------------------------- user-owned tables
create table public.profiles (
  user_id                 uuid primary key references auth.users (id) on delete cascade,
  email                   text,
  country                 text,
  promo_push_opt_in       boolean not null default false,
  marketing_email_opt_in  boolean not null default false,
  pro_unlocked            boolean not null default false,
  created_at              timestamptz not null default now()
);

create table public.follows (
  user_id    uuid not null references auth.users (id) on delete cascade,
  team_id    text not null references public.teams (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, team_id)
);

create table public.devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  platform     text not null check (platform in ('ios', 'android', 'web')),
  push_token   text,
  calendar_id  text,
  last_sync_at timestamptz
);
create index devices_user_idx on public.devices (user_id);

create table public.device_events (
  device_id        uuid not null references public.devices (id) on delete cascade,
  game_id          uuid not null references public.games (id) on delete cascade,
  event_identifier text not null,
  synced_rev       bigint,
  primary key (device_id, game_id)
);

-- Counted per game, never per person: no user id, IP or agent is stored. Written only by the `go` Edge Function.
create table public.link_clicks (
  id         bigint generated always as identity primary key,
  game_id    uuid not null references public.games (id) on delete cascade,
  slot       text not null check (slot in ('watch', 'tickets', 'sponsor')),
  clicked_at timestamptz not null default now()
);
create index link_clicks_game_idx on public.link_clicks (game_id, slot);

-- First-party stats only; no third-party SDKs.
create table public.usage_events (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name    text not null check (char_length(name) between 1 and 64),
  at      timestamptz not null default now()
);
create index usage_events_user_idx on public.usage_events (user_id, at desc);

-- One-time tokens that let a freshly signed-in user take over an anonymous user's follows (see claim_anonymous_follows).
create table public.merge_claims (
  token      uuid primary key default gen_random_uuid(),
  from_user  uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes'
);

-- ---------------------------------------------------------------- row level security
alter table public.leagues       enable row level security;
alter table public.teams         enable row level security;
alter table public.sponsors      enable row level security;
alter table public.games         enable row level security;
alter table public.game_changes  enable row level security;
alter table public.profiles      enable row level security;
alter table public.follows       enable row level security;
alter table public.devices       enable row level security;
alter table public.device_events enable row level security;
alter table public.link_clicks   enable row level security;
alter table public.usage_events  enable row level security;
alter table public.merge_claims  enable row level security;

-- Reference data: read-only for everyone. No write policies exist, and write privileges are revoked below;
-- service_role bypasses RLS and keeps its grants.
create policy leagues_read      on public.leagues      for select to anon, authenticated using (true);
create policy teams_read        on public.teams        for select to anon, authenticated using (true);
create policy sponsors_read     on public.sponsors     for select to anon, authenticated using (true);
create policy games_read        on public.games        for select to anon, authenticated using (true);
create policy game_changes_read on public.game_changes for select to anon, authenticated using (true);

-- User-owned rows.
create policy profiles_own_select on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_own_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy follows_own_select on public.follows for select to authenticated using (user_id = (select auth.uid()));
create policy follows_own_insert on public.follows for insert to authenticated with check (user_id = (select auth.uid()));
create policy follows_own_delete on public.follows for delete to authenticated using (user_id = (select auth.uid()));

create policy devices_own_select on public.devices for select to authenticated using (user_id = (select auth.uid()));
create policy devices_own_insert on public.devices for insert to authenticated with check (user_id = (select auth.uid()));
create policy devices_own_update on public.devices for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy devices_own_delete on public.devices for delete to authenticated using (user_id = (select auth.uid()));

create policy device_events_own_select on public.device_events for select to authenticated
  using (exists (select 1 from public.devices d where d.id = device_id and d.user_id = (select auth.uid())));
create policy device_events_own_insert on public.device_events for insert to authenticated
  with check (exists (select 1 from public.devices d where d.id = device_id and d.user_id = (select auth.uid())));
create policy device_events_own_update on public.device_events for update to authenticated
  using (exists (select 1 from public.devices d where d.id = device_id and d.user_id = (select auth.uid())))
  with check (exists (select 1 from public.devices d where d.id = device_id and d.user_id = (select auth.uid())));
create policy device_events_own_delete on public.device_events for delete to authenticated
  using (exists (select 1 from public.devices d where d.id = device_id and d.user_id = (select auth.uid())));

create policy usage_events_own_insert on public.usage_events for insert to authenticated with check (user_id = (select auth.uid()));
create policy usage_events_own_select on public.usage_events for select to authenticated using (user_id = (select auth.uid()));

-- link_clicks and merge_claims: RLS on, deliberately no policies = no access for anon/authenticated.

-- ---------------------------------------------------------------- privileges (defence in depth beside RLS)
revoke all on public.leagues, public.teams, public.sponsors, public.games, public.game_changes,
  public.profiles, public.follows, public.devices, public.device_events, public.link_clicks,
  public.usage_events, public.merge_claims from anon, authenticated;

grant select on public.leagues, public.teams, public.sponsors, public.games, public.game_changes to anon, authenticated;
grant select on public.profiles to authenticated;
-- pro_unlocked and email are never client-writable: pro_unlocked is set by the server (store receipts, v1.1), email by the trigger below.
grant update (country, promo_push_opt_in, marketing_email_opt_in) on public.profiles to authenticated;
grant select, insert, delete on public.follows to authenticated;
grant select, insert, update, delete on public.devices, public.device_events to authenticated;
grant select, insert on public.usage_events to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------- profiles follow auth.users
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email) values (new.id, new.email) on conflict (user_id) do nothing;
  return new;
end $$;

create function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where user_id = new.id;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
create trigger on_auth_user_email after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function public.sync_profile_email();

revoke all on function public.handle_new_user(), public.sync_profile_email() from public, anon, authenticated;

-- ---------------------------------------------------------------- keeping follows when an anonymous user signs in
-- Flow (see src/lib/auth.ts): the anonymous session calls create_merge_claim() BEFORE signing in and keeps the token
-- on the device; the newly signed-in user calls claim_anonymous_follows(token). Possession of the token proves control
-- of the anonymous session, and the checks below stop it being used for anything else. Chosen over linkIdentity,
-- which cannot cover signInWithOtp / native signInWithIdToken or an account that already exists.
create function public.create_merge_claim() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_token uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.is_anonymous) then
    raise exception 'only anonymous users can start a merge' using errcode = '42501';
  end if;
  delete from public.merge_claims where from_user = v_uid or expires_at < now();
  insert into public.merge_claims (from_user) values (v_uid) returning token into v_token;
  return v_token;
end $$;

create function public.claim_anonymous_follows(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_caller uuid := auth.uid(); v_from uuid; v_moved int; v_devices int;
begin
  if v_caller is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if exists (select 1 from auth.users u where u.id = v_caller and u.is_anonymous) then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select from_user into v_from from public.merge_claims where token = p_token and expires_at > now() for update;
  if v_from is null then raise exception 'invalid or expired claim' using errcode = '42501'; end if;
  delete from public.merge_claims where token = p_token;               -- single use
  if v_from = v_caller then return jsonb_build_object('moved_follows', 0, 'moved_devices', 0); end if;
  if not exists (select 1 from auth.users u where u.id = v_from and u.is_anonymous) then
    raise exception 'claim source is not anonymous' using errcode = '42501';
  end if;
  insert into public.follows (user_id, team_id) select v_caller, f.team_id from public.follows f where f.user_id = v_from
    on conflict do nothing;
  get diagnostics v_moved = row_count;
  delete from public.follows where user_id = v_from;
  update public.devices set user_id = v_caller where user_id = v_from;
  get diagnostics v_devices = row_count;
  return jsonb_build_object('moved_follows', v_moved, 'moved_devices', v_devices);
end $$;

revoke all on function public.create_merge_claim(), public.claim_anonymous_follows(uuid) from public, anon;
grant execute on function public.create_merge_claim(), public.claim_anonymous_follows(uuid) to authenticated;
