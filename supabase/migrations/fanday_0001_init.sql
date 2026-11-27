-- Fanday 0001: everything lives in schema `fanday` of a Supabase project that other apps share. Rules this file keeps
-- (proved by scripts/test-migrations/shared-project.mjs):
--   * every table, function, policy, index and grant is schema-qualified `fanday.`; nothing outside `fanday` is created, altered, dropped or granted on;
--   * the only reads outside `fanday` are in SECURITY DEFINER functions (search_path = ''): auth.users (profiles, purge, deletion checks), auth.identities
--     (ensure_profile: sign-in provider and age of the Apple identity), the catalogs and, for the foreign-rows check, the tables that reference auth.users
--     (read-only, fails closed); plus auth.uid() in policies;
--   * no triggers, and no foreign keys to auth.users (a FK would add system triggers to auth.users). User-owned rows carry a plain user_id;
--     fanday.purge_orphaned_user_rows() removes rows whose auth user is gone (run daily by fanday.run_maintenance, see the end of this file).
-- Idempotent: safe to apply twice. Apply as PLAIN SQL with execute_sql (never apply_migration, `db push` or `db reset`); the file records itself in fanday.schema_versions.
-- Ownership model: a row belongs to a SIGNED-IN USER (user_id) or to a SIGNED-OUT DEVICE (token_id -> device_tokens). Exactly one.

create schema if not exists fanday;
grant usage on schema fanday to anon, authenticated, service_role;
-- pg_graphql (live 1.5.x) follows privileges, so the public reference tables may appear in /graphql/v1 as they do in REST. This keeps
-- GraphQL introspection of this schema off (queries are unaffected). Docs: supabase.github.io/pg_graphql/configuration
comment on schema fanday is e'@graphql({"introspection": false})';

-- ---------------------------------------------------------------- reference tables
create table if not exists fanday.leagues (
  id           text primary key,                       -- slug, e.g. 'nfl'
  name         text not null,
  country      text not null,
  country_code text not null,                          -- ISO-3166 alpha-2 (or 'EU'); drives 12h/24h display
  sport        text not null,
  season       text,
  source       text not null check (source in ('wikipedia', 'official_link')),
  tz           text,
  in_season    boolean not null default true,
  sort         int not null default 0
);

create table if not exists fanday.teams (
  id                    text primary key,              -- slug, e.g. 'nfl-kc'
  league_id             text not null references fanday.leagues (id) on delete cascade,
  name                  text not null,
  short_name            text not null,                 -- neutral text badge ('KC'); never a logo
  wiki_page             text,
  official_calendar_url text
);
create index if not exists teams_league_idx on fanday.teams (league_id);

create table if not exists fanday.sponsors (
  id            uuid primary key default gen_random_uuid(),
  scope_type    text not null check (scope_type in ('league', 'team', 'country', 'city')),
  scope_value   text not null,
  starts_on     date,
  ends_on       date,
  text          text not null,
  url           text,
  push_eligible boolean not null default false
);

create table if not exists fanday.games (
  id            uuid primary key default gen_random_uuid(),
  league_id     text not null references fanday.leagues (id) on delete cascade,
  home_team_id  text not null references fanday.teams (id) on delete cascade,
  away_team_id  text not null references fanday.teams (id) on delete cascade,
  game_date     date not null,
  kickoff_at    timestamptz,
  time_tbc      boolean not null default false,
  status        text not null default 'scheduled' check (status in ('scheduled', 'postponed', 'cancelled', 'final')),
  venue         text,
  broadcast     text,
  country       text,
  source_page   text,
  source_rev    bigint,
  updated_at    timestamptz not null default now(),
  watch_provider text,
  watch_url      text,
  tickets_url    text,
  sponsor_id     uuid references fanday.sponsors (id) on delete set null,
  sponsor_text   text,
  sponsor_url    text,
  unique (league_id, home_team_id, away_team_id, game_date)
);
create index if not exists games_home_idx on fanday.games (home_team_id, game_date);
create index if not exists games_away_idx on fanday.games (away_team_id, game_date);

create table if not exists fanday.game_changes (
  id          bigint generated always as identity primary key,
  game_id     uuid not null references fanday.games (id) on delete cascade,
  field       text not null,
  old_value   text,
  new_value   text,
  detected_at timestamptz not null default now(),
  pushed_at   timestamptz
);
create index if not exists game_changes_game_idx on fanday.game_changes (game_id, detected_at desc);

-- ---------------------------------------------------------------- owners: signed-in users and signed-out devices
-- Created lazily by fanday.ensure_profile() after sign-in (no trigger on auth.users).
create table if not exists fanday.profiles (
  user_id                 uuid primary key,
  email                   text,
  country                 text,
  promo_push_opt_in       boolean not null default false,
  marketing_email_opt_in  boolean not null default false,
  pro_unlocked            boolean not null default false,
  created_at              timestamptz not null default now()
);

-- Who created the auth user, kept INSIDE fanday (nothing is written to auth.users). Deleting the auth user on account deletion is allowed
-- only when created_by_fanday is true (and the user owns nothing outside fanday). Written by fanday-send-link (users it creates) and
-- by ensure_profile() (first Google/Apple sign-in); a row is never overwritten.
create table if not exists fanday.user_origin (
  user_id            uuid primary key,
  created_by_fanday  boolean not null,
  -- true when an Apple identity appeared through a Fanday sign-in (seen fresh, under 10 minutes old, by ensure_profile). Only such an
  -- identity is unlinked on account deletion; an Apple identity from anywhere else is left alone.
  apple_added_by_fanday boolean not null default false,
  created_at         timestamptz not null default now()
);

-- One row per signed-out install. Only the sha256 of the 32-byte token is stored; the token itself lives on the phone.
create table if not exists fanday.device_tokens (
  id           uuid primary key default gen_random_uuid(),
  token_hash   bytea not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  revoked_at   timestamptz,                              -- set on delete
  claimed_at   timestamptz,                              -- set when a signed-in user takes the device's data (single use)
  claimed_by   uuid
);

create table if not exists fanday.follows (
  id         bigint generated always as identity primary key,
  user_id    uuid,
  token_id   uuid references fanday.device_tokens (id) on delete cascade,
  team_id    text not null references fanday.teams (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((user_id is null) <> (token_id is null))
);
create unique index if not exists follows_user_team_uq  on fanday.follows (user_id, team_id)  where user_id is not null;
create unique index if not exists follows_token_team_uq on fanday.follows (token_id, team_id) where token_id is not null;

-- A phone's calendar registration (not to be confused with device_tokens, the sign-out identity).
create table if not exists fanday.devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid,
  token_id     uuid references fanday.device_tokens (id) on delete cascade,
  platform     text not null check (platform in ('ios', 'android', 'web')),
  push_token   text,
  calendar_id  text,
  last_sync_at timestamptz,
  check ((user_id is null) <> (token_id is null))
);
create index if not exists devices_user_idx  on fanday.devices (user_id)  where user_id is not null;
create index if not exists devices_token_idx on fanday.devices (token_id) where token_id is not null;

create table if not exists fanday.device_events (
  device_id        uuid not null references fanday.devices (id) on delete cascade,
  game_id          uuid not null references fanday.games (id) on delete cascade,
  event_identifier text not null,
  synced_rev       bigint,
  primary key (device_id, game_id)
);

-- Counted per game and slot per day, never per person. Written only by fanday-go through record_link_click() (service_role).
create table if not exists fanday.link_clicks (
  game_id uuid not null references fanday.games (id) on delete cascade,
  slot    text not null check (slot in ('watch', 'tickets', 'sponsor')),
  day     date not null default current_date,
  clicks  int  not null default 0 check (clicks >= 0),
  primary key (game_id, slot, day)
);

create table if not exists fanday.usage_events (
  id       bigint generated always as identity primary key,
  user_id  uuid,
  token_id uuid references fanday.device_tokens (id) on delete cascade,
  name     text not null check (char_length(name) between 1 and 64),
  at       timestamptz not null default now(),
  check ((user_id is null) <> (token_id is null))
);
create index if not exists usage_events_user_idx  on fanday.usage_events (user_id, at desc)  where user_id is not null;
create index if not exists usage_events_token_idx on fanday.usage_events (token_id, at desc) where token_id is not null;

-- Abuse limits for the Edge Functions. Counters only: no IP and no email address is ever stored (callers pass a salted hash;
-- the salt changes every UTC day and is deleted after two days).
create table if not exists fanday.rate_counters (
  scope        text not null,
  key          text not null,
  window_start timestamptz not null,
  n            int not null default 0,
  primary key (scope, key, window_start)
);
-- Which migrations/seeds were applied to THIS schema. Fanday's SQL is applied as plain SQL (execute_sql), never through apply_migration,
-- because apply_migration writes rows into the shared supabase_migrations.schema_migrations, which the other apps use too.
-- Each file records itself on its last line, so a rollback that drops the schema leaves nothing behind anywhere else.
create table if not exists fanday.schema_versions (
  version    text primary key,
  applied_at timestamptz not null default now()
);

-- sha256 of one shared secret per Edge Function that does not hold the service-role key (ingest, go, device). The functions call
-- SECURITY DEFINER RPCs with the PUBLISHABLE key and pass their secret; the RPC checks it here (fanday._check_secret). The hash is
-- inserted by hand, once per secret, with SQL (see the PR body); nothing but the RPCs ever reads this table.
create table if not exists fanday.function_secrets (
  name        text primary key check (name in ('ingest', 'go', 'device')),
  secret_hash bytea not null check (length(secret_hash) = 32),
  set_at      timestamptz not null default now()
);

-- One row per alert kind and window: lets fanday-send-link mail "the hourly cap was reached" at most once per hour.
create table if not exists fanday.alert_log (
  kind         text not null,
  window_start timestamptz not null,
  primary key (kind, window_start)
);
create table if not exists fanday.rl_salts (
  day  date primary key,
  salt text not null
);

-- ---------------------------------------------------------------- row level security
alter table fanday.leagues        enable row level security;
alter table fanday.teams          enable row level security;
alter table fanday.sponsors       enable row level security;
alter table fanday.games          enable row level security;
alter table fanday.game_changes   enable row level security;
alter table fanday.profiles       enable row level security;
alter table fanday.user_origin    enable row level security;
alter table fanday.device_tokens  enable row level security;
alter table fanday.follows        enable row level security;
alter table fanday.devices        enable row level security;
alter table fanday.device_events  enable row level security;
alter table fanday.link_clicks    enable row level security;
alter table fanday.usage_events   enable row level security;
alter table fanday.rate_counters  enable row level security;
alter table fanday.rl_salts       enable row level security;
alter table fanday.alert_log      enable row level security;
alter table fanday.schema_versions enable row level security;
alter table fanday.function_secrets enable row level security;

drop policy if exists leagues_read      on fanday.leagues;
drop policy if exists teams_read        on fanday.teams;
drop policy if exists sponsors_read     on fanday.sponsors;
drop policy if exists games_read        on fanday.games;
drop policy if exists game_changes_read on fanday.game_changes;
create policy leagues_read      on fanday.leagues      for select to anon, authenticated using (true);
create policy teams_read        on fanday.teams        for select to anon, authenticated using (true);
create policy sponsors_read     on fanday.sponsors     for select to anon, authenticated
  using ((starts_on is null or starts_on <= current_date) and (ends_on is null or ends_on >= current_date));
create policy games_read        on fanday.games        for select to anon, authenticated using (true);
create policy game_changes_read on fanday.game_changes for select to anon, authenticated using (true);

-- Signed-in users: own rows only. Device-owned rows (user_id is null) never match, so they are closed to direct client access;
-- signed-out devices go through the token RPCs below. device_tokens, link_clicks, rate_counters, rl_salts: RLS on, no policies.
drop policy if exists profiles_own_select on fanday.profiles;
drop policy if exists profiles_own_update on fanday.profiles;
create policy profiles_own_select on fanday.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_own_update on fanday.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists follows_own_select on fanday.follows;
drop policy if exists follows_own_insert on fanday.follows;   -- direct insert is closed (see grants); rows come from user_follows_add
drop policy if exists follows_own_delete on fanday.follows;
create policy follows_own_select on fanday.follows for select to authenticated using (user_id = (select auth.uid()));
create policy follows_own_delete on fanday.follows for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists devices_own_select on fanday.devices;
drop policy if exists devices_own_insert on fanday.devices;
drop policy if exists devices_own_update on fanday.devices;
drop policy if exists devices_own_delete on fanday.devices;
create policy devices_own_select on fanday.devices for select to authenticated using (user_id = (select auth.uid()));
create policy devices_own_update on fanday.devices for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy devices_own_delete on fanday.devices for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists device_events_own_select on fanday.device_events;
drop policy if exists device_events_own_insert on fanday.device_events;
drop policy if exists device_events_own_update on fanday.device_events;
drop policy if exists device_events_own_delete on fanday.device_events;
create policy device_events_own_select on fanday.device_events for select to authenticated
  using (exists (select 1 from fanday.devices d where d.id = device_id and d.user_id = (select auth.uid())));
create policy device_events_own_insert on fanday.device_events for insert to authenticated
  with check (exists (select 1 from fanday.devices d where d.id = device_id and d.user_id = (select auth.uid())));
create policy device_events_own_update on fanday.device_events for update to authenticated
  using (exists (select 1 from fanday.devices d where d.id = device_id and d.user_id = (select auth.uid())))
  with check (exists (select 1 from fanday.devices d where d.id = device_id and d.user_id = (select auth.uid())));
create policy device_events_own_delete on fanday.device_events for delete to authenticated
  using (exists (select 1 from fanday.devices d where d.id = device_id and d.user_id = (select auth.uid())));

drop policy if exists usage_events_own_insert on fanday.usage_events;
drop policy if exists usage_events_own_select on fanday.usage_events;
create policy usage_events_own_select on fanday.usage_events for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- privileges (defence in depth beside RLS)
revoke all on fanday.leagues, fanday.teams, fanday.sponsors, fanday.games, fanday.game_changes, fanday.profiles,
  fanday.user_origin, fanday.device_tokens, fanday.follows, fanday.devices, fanday.device_events, fanday.link_clicks, fanday.usage_events,
  fanday.rate_counters, fanday.rl_salts, fanday.alert_log, fanday.schema_versions, fanday.function_secrets from anon, authenticated;

grant select on fanday.leagues, fanday.teams, fanday.sponsors, fanday.games, fanday.game_changes to anon, authenticated;
grant select on fanday.profiles to authenticated;
-- pro_unlocked and email are never client-writable: pro_unlocked is set by the server, email by ensure_profile().
grant update (country, promo_push_opt_in, marketing_email_opt_in) on fanday.profiles to authenticated;
-- No direct INSERT for signed-in users on follows, devices and usage_events: they would be unbounded. Those rows are created only by the
-- capped RPCs user_follows_add, user_device_upsert and user_log_event (below). Updates and deletes of own rows stay direct.
grant select, delete on fanday.follows to authenticated;
grant select, update, delete on fanday.devices to authenticated;
grant select, insert, update, delete on fanday.device_events to authenticated;
grant select on fanday.usage_events to authenticated;

grant all on all tables in schema fanday to service_role;
grant usage, select on all sequences in schema fanday to service_role;

-- ---------------------------------------------------------------- signed-in users: lazy profile and origin (replaces the auth.users triggers)
-- Also records, once, whether Fanday created this auth user. It says true only if ALL hold: the auth user was created in the last
-- 10 minutes; it owns no row outside fanday; its identities are only google and/or apple (so an email or other-app user is never claimed);
-- and no origin row exists yet. Otherwise false. (Users made by fanday-send-link are recorded true by that function, via set_user_origin.)
create or replace function fanday.ensure_profile() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_created timestamptz; v_true boolean; v_apple boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into fanday.profiles (user_id, email)
    select u.id, u.email from auth.users u where u.id = v_uid
  on conflict (user_id) do update set email = excluded.email;
  -- HEURISTIC, not proof: Supabase does not record which app added an identity. An Apple identity under 10 minutes old that is seen here
  -- (this call follows a Fanday sign-in) is taken to have been added by Fanday. An Apple identity linked elsewhere within those 10 minutes
  -- would be misread as ours. The only consequence is that account deletion also unlinks that Apple identity (see apple_added_by_fanday).
  v_apple := exists (select 1 from auth.identities i where i.user_id = v_uid and i.provider = 'apple' and i.created_at > now() - interval '10 minutes');
  if not exists (select 1 from fanday.user_origin o where o.user_id = v_uid) then
    select u.created_at into v_created from auth.users u where u.id = v_uid;
    v_true := v_created is not null
      and v_created > now() - interval '10 minutes'
      and exists (select 1 from auth.identities i where i.user_id = v_uid)
      and not exists (select 1 from auth.identities i where i.user_id = v_uid and i.provider not in ('google', 'apple'))
      and not fanday.user_has_foreign_rows(v_uid);
    insert into fanday.user_origin (user_id, created_by_fanday, apple_added_by_fanday) values (v_uid, coalesce(v_true, false), v_apple) on conflict (user_id) do nothing;
  elsif v_apple then
    update fanday.user_origin set apple_added_by_fanday = true where user_id = v_uid and not apple_added_by_fanday;
  end if;
end $$;
revoke all on function fanday.ensure_profile() from public, anon;
grant execute on function fanday.ensure_profile() to authenticated;

-- ---------------------------------------------------------------- signed-out devices
-- Token lookup shared by the RPCs below. Not callable by clients. Raises for an unknown, revoked or claimed token.
create or replace function fanday._token_id(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_token is null or length(p_token) < 43 or length(p_token) > 200 then
    raise exception 'invalid token' using errcode = '28000';
  end if;
  select t.id into v_id from fanday.device_tokens t
   where t.token_hash = sha256(convert_to(p_token, 'UTF8')) and t.revoked_at is null and t.claimed_at is null;
  if v_id is null then raise exception 'invalid token' using errcode = '28000'; end if;
  update fanday.device_tokens set last_used_at = now() where id = v_id and last_used_at < now() - interval '1 hour';
  return v_id;
end $$;
revoke all on function fanday._token_id(text) from public, anon, authenticated;

-- Per-function secret check (see function_secrets). Fails closed: no row, no secret, short secret or a wrong one all raise.
create or replace function fanday._check_secret(p_name text, p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or length(p_secret) < 16
     or not exists (select 1 from fanday.function_secrets s where s.name = p_name and s.secret_hash = sha256(convert_to(p_secret, 'UTF8'))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;
revoke all on function fanday._check_secret(text, text) from public, anon, authenticated;

-- fanday-device calls this with the publishable key and its secret. The caller's address is hashed here with the daily salt and only
-- counted (20 tokens per caller per hour, 2000 per hour overall); neither the address nor the hash of it is stored in any row but the counter key.
create or replace function fanday.issue_device_token(p_secret text, p_addr text, p_hash bytea) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_hour timestamptz := date_trunc('hour', now() at time zone 'utc') at time zone 'utc'; v_key text; v_id uuid;
begin
  perform fanday._check_secret('device', p_secret);
  if p_hash is null or length(p_hash) <> 32 then raise exception 'bad hash' using errcode = '22023'; end if;
  v_key := encode(sha256(convert_to(fanday.rl_salt() || ':device-ip:' || coalesce(p_addr, 'unknown'), 'UTF8')), 'hex');
  if not fanday.rl_hit('device-ip', v_key, v_hour, 20) then raise exception 'rate_limited' using errcode = 'P0001'; end if;
  if not fanday.rl_hit('device-all', 'all', v_hour, 2000) then raise exception 'rate_limited' using errcode = 'P0001'; end if;
  insert into fanday.device_tokens (token_hash) values (p_hash) returning id into v_id;
  return v_id;
end $$;
revoke all on function fanday.issue_device_token(text, text, bytea) from public;
grant execute on function fanday.issue_device_token(text, text, bytea) to anon, authenticated, service_role;

create or replace function fanday.device_follows_list(p_token text) returns text[]
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := fanday._token_id(p_token);
begin
  return coalesce((select array_agg(f.team_id order by f.team_id) from fanday.follows f where f.token_id = v_id), '{}');
end $$;

-- Replaces the device's follows with exactly this list (unknown team ids are skipped).
create or replace function fanday.device_follows_set(p_token text, p_team_ids text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := fanday._token_id(p_token); v_ids text[] := coalesce(p_team_ids, '{}');
begin
  if coalesce(array_length(v_ids, 1), 0) > 300 then raise exception 'too many teams' using errcode = '22023'; end if;
  delete from fanday.follows where token_id = v_id and team_id <> all (v_ids);
  insert into fanday.follows (token_id, team_id) select v_id, t.id from fanday.teams t where t.id = any (v_ids)
    on conflict do nothing;
end $$;

-- What this phone wrote to its calendar. p_events: [{game_id, event_identifier, synced_rev}]. Another owner's device id is refused.
create or replace function fanday.device_calendar_upsert(p_token text, p_device uuid, p_platform text, p_calendar_id text, p_events jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := fanday._token_id(p_token); v_n int;
begin
  if p_device is null then raise exception 'device id required' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_events, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_events, '[]'::jsonb)) > 500 then
    raise exception 'too many events' using errcode = '22023';
  end if;
  -- At most 5 phones per token. The token row is locked first so two parallel calls cannot both slip past the count.
  perform 1 from fanday.device_tokens t where t.id = v_id for update;
  if not exists (select 1 from fanday.devices d where d.id = p_device)
     and (select count(*) from fanday.devices d where d.token_id = v_id) >= 5 then
    raise exception 'too many devices' using errcode = '22023';
  end if;
  -- One atomic statement, no check-then-write gap: the update arm only fires for a row this token owns. If another owner (a user or
  -- another token) holds the id, nothing is inserted or changed, zero rows come back, and we refuse.
  insert into fanday.devices (id, token_id, platform, calendar_id, last_sync_at) values (p_device, v_id, p_platform, p_calendar_id, now())
  on conflict (id) do update set platform = excluded.platform, calendar_id = excluded.calendar_id, last_sync_at = now()
    where fanday.devices.token_id = v_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'device belongs to another owner' using errcode = '42501'; end if;
  insert into fanday.device_events (device_id, game_id, event_identifier, synced_rev)
    select p_device, x.game_id, x.event_identifier, x.synced_rev
      from jsonb_to_recordset(coalesce(p_events, '[]'::jsonb)) as x(game_id uuid, event_identifier text, synced_rev bigint)
     where exists (select 1 from fanday.games g where g.id = x.game_id)
  on conflict (device_id, game_id) do update set event_identifier = excluded.event_identifier, synced_rev = excluded.synced_rev;
end $$;

create or replace function fanday.device_calendar_forget(p_token text, p_device uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := fanday._token_id(p_token);
begin
  delete from fanday.devices where id = p_device and token_id = v_id;
end $$;

create or replace function fanday.device_log_event(p_token text, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := fanday._token_id(p_token);
begin
  -- Best effort and capped: 200 events per device per UTC day; the rest are dropped without an error.
  if not fanday.rl_hit('device-log', v_id::text, date_trunc('day', now() at time zone 'utc') at time zone 'utc', 200) then return; end if;
  insert into fanday.usage_events (token_id, name) values (v_id, p_name);
end $$;

-- ---------------------------------------------------------------- signed-in writes (capped; direct INSERT is revoked)
-- Adds teams to the caller's follows (unknown team ids are skipped). At most 300 follows per user, 200 calls per user per UTC day.
create or replace function fanday.user_follows_add(p_team_ids text[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_ids text[] := coalesce(p_team_ids, '{}'); v_n int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if coalesce(array_length(v_ids, 1), 0) > 300 then raise exception 'too many teams' using errcode = '22023'; end if;
  if not fanday.rl_hit('user-follows', v_uid::text, date_trunc('day', now() at time zone 'utc') at time zone 'utc', 200) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into fanday.follows (user_id, team_id) select v_uid, t.id from fanday.teams t where t.id = any (v_ids) on conflict do nothing;
  get diagnostics v_n = row_count;
  if (select count(*) from fanday.follows f where f.user_id = v_uid) > 300 then raise exception 'too many teams' using errcode = '22023'; end if;
  return v_n;
end $$;

-- Registers or refreshes one of the caller's phones. At most 5 phones per user; another owner's device id is refused.
create or replace function fanday.user_device_upsert(p_device uuid, p_platform text, p_calendar_id text, p_push_token text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_n int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_device is null then raise exception 'device id required' using errcode = '22023'; end if;
  if not fanday.rl_hit('user-device', v_uid::text, date_trunc('day', now() at time zone 'utc') at time zone 'utc', 200) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fanday.user_device:' || v_uid::text, 0));
  if not exists (select 1 from fanday.devices d where d.id = p_device)
     and (select count(*) from fanday.devices d where d.user_id = v_uid) >= 5 then
    raise exception 'too many devices' using errcode = '22023';
  end if;
  insert into fanday.devices (id, user_id, platform, calendar_id, push_token, last_sync_at) values (p_device, v_uid, p_platform, p_calendar_id, p_push_token, now())
  on conflict (id) do update set platform = excluded.platform, calendar_id = excluded.calendar_id, push_token = coalesce(excluded.push_token, fanday.devices.push_token), last_sync_at = now()
    where fanday.devices.user_id = v_uid;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'device belongs to another owner' using errcode = '42501'; end if;
end $$;

-- Best effort and capped like device_log_event: 200 events per user per UTC day; the rest are dropped without an error.
create or replace function fanday.user_log_event(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not fanday.rl_hit('user-log', v_uid::text, date_trunc('day', now() at time zone 'utc') at time zone 'utc', 200) then return; end if;
  insert into fanday.usage_events (user_id, name) values (v_uid, p_name);
end $$;
revoke all on function fanday.user_follows_add(text[]), fanday.user_device_upsert(uuid, text, text, text), fanday.user_log_event(text) from public, anon;
grant execute on function fanday.user_follows_add(text[]), fanday.user_device_upsert(uuid, text, text, text), fanday.user_log_event(text) to authenticated;

-- Signed-out delete: removes every row owned by the device and revokes the token (the revoked row, a hash only, is purged by cleanup).
create or replace function fanday.device_delete(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := fanday._token_id(p_token); v_f int; v_d int; v_u int;
begin
  delete from fanday.follows where token_id = v_id;       get diagnostics v_f = row_count;
  delete from fanday.devices where token_id = v_id;       get diagnostics v_d = row_count;   -- device_events go by cascade
  delete from fanday.usage_events where token_id = v_id;  get diagnostics v_u = row_count;
  update fanday.device_tokens set revoked_at = now() where id = v_id;
  return jsonb_build_object('follows', v_f, 'devices', v_d, 'usage_events', v_u, 'revoked', true);
end $$;

-- First sign-in on a phone that has a device token: the signed-in user takes over the device's follows, devices, events and usage rows,
-- and the token dies. Single use: a used, revoked or unknown token, or one claimed by anyone (including the same user), is refused with
-- the same error and nothing moves. REVIEW: this is the one place where data changes owner.
create or replace function fanday.claim_device(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_caller uuid := auth.uid(); v_id uuid; v_claimed timestamptz; v_revoked timestamptz; v_f int; v_d int;
begin
  if v_caller is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_token is null or length(p_token) < 43 or length(p_token) > 200 then raise exception 'invalid or used token' using errcode = '42501'; end if;
  select t.id, t.claimed_at, t.revoked_at into v_id, v_claimed, v_revoked
    from fanday.device_tokens t where t.token_hash = sha256(convert_to(p_token, 'UTF8')) for update;
  if v_id is null or v_claimed is not null or v_revoked is not null then
    raise exception 'invalid or used token' using errcode = '42501';
  end if;
  update fanday.device_tokens set claimed_at = now(), claimed_by = v_caller where id = v_id;
  insert into fanday.follows (user_id, team_id) select v_caller, f.team_id from fanday.follows f where f.token_id = v_id on conflict do nothing;
  get diagnostics v_f = row_count;
  delete from fanday.follows where token_id = v_id;
  update fanday.devices set user_id = v_caller, token_id = null where token_id = v_id;
  get diagnostics v_d = row_count;
  update fanday.usage_events set user_id = v_caller, token_id = null where token_id = v_id;
  return jsonb_build_object('moved_follows', v_f, 'moved_devices', v_d);
end $$;

revoke all on function fanday.device_follows_list(text), fanday.device_follows_set(text, text[]),
  fanday.device_calendar_upsert(text, uuid, text, text, jsonb), fanday.device_calendar_forget(text, uuid),
  fanday.device_log_event(text, text), fanday.device_delete(text), fanday.claim_device(text) from public, anon, authenticated;
grant execute on function fanday.device_follows_list(text), fanday.device_follows_set(text, text[]),
  fanday.device_calendar_upsert(text, uuid, text, text, jsonb), fanday.device_calendar_forget(text, uuid),
  fanday.device_log_event(text, text), fanday.device_delete(text) to anon, authenticated;
grant execute on function fanday.claim_device(text) to authenticated;

-- ---------------------------------------------------------------- abuse limits (service_role, used by fanday-device and fanday-send-link)
create or replace function fanday.rl_salt() returns text
language plpgsql security definer set search_path = '' as $$
declare v_day date := (now() at time zone 'utc')::date; v_salt text;
begin
  insert into fanday.rl_salts (day, salt) values (v_day, gen_random_uuid()::text || gen_random_uuid()::text) on conflict (day) do nothing;
  delete from fanday.rl_salts where day < v_day - 1;
  select salt into v_salt from fanday.rl_salts where day = v_day;
  return v_salt;
end $$;

-- Counts one hit and says whether it is within the limit.
create or replace function fanday.rl_hit(p_scope text, p_key text, p_window timestamptz, p_limit int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  insert into fanday.rate_counters as c (scope, key, window_start, n) values (p_scope, p_key, p_window, 1)
  on conflict (scope, key, window_start) do update set n = c.n + 1 returning c.n into v_n;
  return v_n <= p_limit;
end $$;
-- True only for the first caller per (kind, window): the dedupe for alert emails. Old rows are removed by cleanup.
create or replace function fanday.alert_once(p_kind text, p_window timestamptz) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  insert into fanday.alert_log (kind, window_start) values (p_kind, p_window) on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;
revoke all on function fanday.rl_salt(), fanday.rl_hit(text, text, timestamptz, int), fanday.alert_once(text, timestamptz) from public, anon, authenticated;
grant execute on function fanday.rl_salt(), fanday.rl_hit(text, text, timestamptz, int), fanday.alert_once(text, timestamptz) to service_role;

-- ---------------------------------------------------------------- link counting (called by fanday-go with the publishable key + its secret)
create or replace function fanday.record_link_click(p_secret text, p_game uuid, p_slot text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform fanday._check_secret('go', p_secret);
  insert into fanday.link_clicks (game_id, slot, day, clicks) values (p_game, p_slot, current_date, 1)
  on conflict (game_id, slot, day) do update set clicks = fanday.link_clicks.clicks + 1;
end $$;
revoke all on function fanday.record_link_click(text, uuid, text) from public;
grant execute on function fanday.record_link_click(text, uuid, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- account deletion support (service_role; used by fanday-delete-account / fanday-send-link)
-- Read-only lookup in auth.users for the send-link function (no user list in the Admin API by email).
create or replace function fanday.auth_user_id_by_email(p_email text) returns uuid
language sql security definer set search_path = '' as $$
  select u.id from auth.users u where lower(u.email) = lower(p_email) limit 1;
$$;

-- True when the user owns a row in ANY table outside `fanday` that points at them. A table counts when it has
--   (a) a column named user_id, or
--   (b) a column, whatever its name, that is a foreign key to auth.users (id, owner_id, profile_id, ...), or
--   (c) storage.objects.owner / owner_id (Storage keeps the owner as plain columns).
-- Read-only, catalog-driven. System schemas are skipped (auth.* tables reference auth.users too, but they are the login itself).
-- Fails closed: a table that cannot be read counts as "has rows", and so does a table with row level security that this function's
-- owner would not see in full (the owner is neither superuser/BYPASSRLS nor the table owner without FORCE RLS): "0 rows visible" is not "no rows".
create or replace function fanday.user_has_foreign_rows(p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r record; v_found boolean; v_me oid; v_bypass boolean;
begin
  select ro.oid, (ro.rolsuper or ro.rolbypassrls) into v_me, v_bypass from pg_catalog.pg_roles ro where ro.rolname = current_user;
  if v_me is null then return true; end if;
  for r in
    select distinct n.nspname as s, c.relname as t, a.attname as col, (a.atttypid = 'pg_catalog.uuid'::regtype) as is_uuid,
           c.relrowsecurity as rls, c.relforcerowsecurity as frls, c.relowner as own
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where c.relkind in ('r', 'p') and not c.relispartition
       and (
         ( n.nspname <> 'fanday' and n.nspname not like 'pg\_%' and n.nspname <> 'information_schema'
           and n.nspname not in ('auth', 'storage', 'realtime', 'vault', 'extensions', 'graphql', 'graphql_public', 'supabase_functions',
                                 'supabase_migrations', 'pgsodium', 'pgsodium_masks', 'cron', 'net', 'pgbouncer', '_realtime', '_analytics', '_supavisor', 'pgmq')
           and ( a.attname = 'user_id'
                 or exists (select 1 from pg_catalog.pg_constraint k
                             where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'auth.users'::pg_catalog.regclass and k.conkey = array[a.attnum]) ) )
         or ( n.nspname = 'storage' and c.relname = 'objects' and a.attname in ('owner', 'owner_id') )
       )
  loop
    if r.rls and not v_bypass and not (r.own = v_me and not r.frls) then return true; end if;
    begin
      if r.is_uuid then
        execute format('select exists (select 1 from %I.%I where %I = $1)', r.s, r.t, r.col) into v_found using p_user;
      else
        execute format('select exists (select 1 from %I.%I where %I::text = $1::text)', r.s, r.t, r.col) into v_found using p_user;
      end if;
    exception when others then
      return true;
    end;
    if v_found then return true; end if;
  end loop;
  return false;
end $$;

-- The rule: the auth user may be deleted only if Fanday created it (fanday.user_origin.created_by_fanday) AND it owns nothing outside `fanday`.
create or replace function fanday.auth_user_deletable(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_created boolean; v_foreign boolean; v_apple boolean;
begin
  select o.created_by_fanday, o.apple_added_by_fanday into v_created, v_apple from fanday.user_origin o where o.user_id = p_user;
  v_apple := coalesce(v_apple, false);
  v_created := coalesce(v_created, false);
  if not exists (select 1 from auth.users u where u.id = p_user) then v_created := false; end if;
  v_foreign := fanday.user_has_foreign_rows(p_user);
  return jsonb_build_object('fanday_created', v_created, 'foreign_rows', v_foreign, 'deletable', v_created and not v_foreign,
                            'apple_added_by_fanday', v_apple);
end $$;

-- fanday-send-link records the users it creates. Never overwrites an existing row.
create or replace function fanday.set_user_origin(p_user uuid, p_created boolean) returns void
language sql security definer set search_path = '' as $$
  insert into fanday.user_origin (user_id, created_by_fanday) values (p_user, p_created) on conflict (user_id) do nothing;
$$;
-- Removes the origin row once the account is gone or unlinked (kept until then so a failed auth-user delete can be retried).
create or replace function fanday.delete_user_origin(p_user uuid) returns void
language sql security definer set search_path = '' as $$
  delete from fanday.user_origin where user_id = p_user;
$$;

-- Deletes every Fanday row of a signed-in user except user_origin (see delete_user_origin). Always runs on account deletion.
create or replace function fanday.delete_user_data(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_f int; v_d int; v_u int; v_p int; v_t int;
begin
  delete from fanday.follows where user_id = p_user;       get diagnostics v_f = row_count;
  delete from fanday.devices where user_id = p_user;       get diagnostics v_d = row_count;   -- device_events by cascade
  delete from fanday.usage_events where user_id = p_user;  get diagnostics v_u = row_count;
  delete from fanday.profiles where user_id = p_user;      get diagnostics v_p = row_count;
  delete from fanday.device_tokens where claimed_by = p_user; get diagnostics v_t = row_count;
  return jsonb_build_object('follows', v_f, 'devices', v_d, 'usage_events', v_u, 'profiles', v_p, 'tokens', v_t);
end $$;

-- ---------------------------------------------------------------- cleanup (service_role only; run daily through run_maintenance below)
-- Device tokens unused for p_months (default 24, the retention in the privacy policy), claimed or revoked ones after 30 days,
-- and rate counters older than 2 days. Their follows, devices and events go by cascade.
create or replace function fanday.cleanup_unused_device_tokens(p_months int default 24) returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  delete from fanday.device_tokens
   where last_used_at < now() - make_interval(months => p_months)
      or coalesce(revoked_at, claimed_at) < now() - interval '30 days';
  get diagnostics v_n = row_count;
  delete from fanday.rate_counters where window_start < now() - interval '2 days';
  delete from fanday.alert_log where window_start < now() - interval '2 days';
  return v_n;
end $$;

-- No foreign key to auth.users (see header), so rows of users deleted elsewhere (dashboard, another app's admin) are swept here.
create or replace function fanday.purge_orphaned_user_rows() returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int := 0; v_c int;
begin
  delete from fanday.follows      f where f.user_id is not null and not exists (select 1 from auth.users u where u.id = f.user_id); get diagnostics v_c = row_count; v_n := v_n + v_c;
  delete from fanday.devices      d where d.user_id is not null and not exists (select 1 from auth.users u where u.id = d.user_id); get diagnostics v_c = row_count; v_n := v_n + v_c;
  delete from fanday.usage_events e where e.user_id is not null and not exists (select 1 from auth.users u where u.id = e.user_id); get diagnostics v_c = row_count; v_n := v_n + v_c;
  delete from fanday.profiles     p where not exists (select 1 from auth.users u where u.id = p.user_id); get diagnostics v_c = row_count; v_n := v_n + v_c;
  delete from fanday.user_origin  o where not exists (select 1 from auth.users u where u.id = o.user_id); get diagnostics v_c = row_count; v_n := v_n + v_c;
  return v_n;
end $$;

-- Daily housekeeping, called by the ingest workflow through fanday-ingest ({"mode":"maintenance"}), no pg_cron. Same secret as ingest
-- (hash-checked like the other function RPCs). The orphan purge is skipped when auth.users is empty, so a wiped or mis-pointed
-- auth table can never turn it into "delete everything".
create or replace function fanday.run_maintenance(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_tokens int; v_orphans int := 0; v_purged boolean := false;
begin
  perform fanday._check_secret('ingest', p_secret);
  v_tokens := fanday.cleanup_unused_device_tokens(24);
  if exists (select 1 from auth.users) then v_orphans := fanday.purge_orphaned_user_rows(); v_purged := true; end if;
  return jsonb_build_object('device_tokens_removed', v_tokens, 'orphan_rows_removed', v_orphans, 'orphan_purge_ran', v_purged);
end $$;
revoke all on function fanday.run_maintenance(text) from public;
grant execute on function fanday.run_maintenance(text) to anon, authenticated, service_role;

revoke all on function fanday.auth_user_id_by_email(text), fanday.user_has_foreign_rows(uuid), fanday.auth_user_deletable(uuid),
  fanday.set_user_origin(uuid, boolean), fanday.delete_user_origin(uuid), fanday.delete_user_data(uuid), fanday.cleanup_unused_device_tokens(int), fanday.purge_orphaned_user_rows() from public, anon, authenticated;
grant execute on function fanday.auth_user_id_by_email(text), fanday.user_has_foreign_rows(uuid), fanday.auth_user_deletable(uuid),
  fanday.set_user_origin(uuid, boolean), fanday.delete_user_origin(uuid), fanday.delete_user_data(uuid), fanday.cleanup_unused_device_tokens(int), fanday.purge_orphaned_user_rows() to service_role;

insert into fanday.schema_versions (version) values ('fanday_0001_init') on conflict do nothing;
