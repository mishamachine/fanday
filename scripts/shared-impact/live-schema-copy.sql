-- Schema-only COPY of the live shared project (ref ywcrzkvwamjchjjkfrve), rebuilt from read-only catalog queries on 2026-11-05
-- (pg_get_constraintdef / indexdef / functiondef / viewdef, pg_policies, relacl, pg_default_acl). NO ROW DATA. Run as supabase_admin
-- against a fresh public.ecr.aws/supabase/postgres:17.11.0.004 container (which supplies the platform schemas, roles and event triggers).
-- Covers: public (9 tables incl. the lessons backup, 2 sequences, 1 view, 2 functions, 3 triggers, 7 policies, ACLs), auth.users / auth.identities
-- reshaped to the live columns, supabase_migrations.schema_migrations. Live postgres is 17.6; the image is 17.11. See docs/shared-db-impact.md for gaps.
\set ON_ERROR_STOP on

-- ---------- auth.users: bring the image's older skeleton up to the live column set (live: 41 columns), then auth.identities
alter table auth.users
  add column if not exists email_confirmed_at timestamptz, add column if not exists phone text default null::character varying,
  add column if not exists phone_confirmed_at timestamptz, add column if not exists phone_change text default ''::character varying,
  add column if not exists phone_change_token varchar default ''::character varying, add column if not exists phone_change_sent_at timestamptz,
  add column if not exists email_change_token_new varchar, add column if not exists email_change_token_current varchar default ''::character varying,
  add column if not exists email_change_confirm_status smallint default 0, add column if not exists banned_until timestamptz,
  add column if not exists reauthentication_token varchar default ''::character varying, add column if not exists reauthentication_sent_at timestamptz,
  add column if not exists is_sso_user boolean not null default false, add column if not exists deleted_at timestamptz,
  add column if not exists is_anonymous boolean not null default false;
alter table auth.users drop constraint if exists users_email_key;
drop index if exists auth.users_email_key;
alter table auth.users add constraint users_email_change_confirm_status_check check (email_change_confirm_status >= 0 and email_change_confirm_status <= 2);
alter table auth.users add constraint users_phone_key unique (phone);
create unique index if not exists confirmation_token_idx on auth.users using btree (confirmation_token) where ((confirmation_token)::text !~ '^[0-9 ]*$'::text);
create unique index if not exists email_change_token_current_idx on auth.users using btree (email_change_token_current) where ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);
create unique index if not exists email_change_token_new_idx on auth.users using btree (email_change_token_new) where ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);
create unique index if not exists reauthentication_token_idx on auth.users using btree (reauthentication_token) where ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);
create unique index if not exists recovery_token_idx on auth.users using btree (recovery_token) where ((recovery_token)::text !~ '^[0-9 ]*$'::text);
create unique index if not exists users_email_partial_key on auth.users using btree (email) where (is_sso_user = false);
create index if not exists users_is_anonymous_idx on auth.users using btree (is_anonymous);
grant select, insert, update, delete, truncate, references, trigger, maintain on auth.users to postgres with grant option;

create table auth.identities (
  provider_id text not null, user_id uuid not null, identity_data jsonb not null, provider text not null,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz, email text,
  id uuid not null default gen_random_uuid(),
  constraint identities_pkey primary key (id), constraint identities_provider_id_provider_unique unique (provider_id, provider),
  constraint identities_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade);
create index identities_email_idx on auth.identities using btree (email text_pattern_ops);
create index identities_user_id_idx on auth.identities using btree (user_id);
alter table auth.identities owner to supabase_auth_admin;
revoke all on auth.identities from public;
grant select, insert, update, delete, truncate, references, trigger, maintain on auth.identities to supabase_auth_admin, dashboard_user;
grant select, insert, update, delete, truncate, references, trigger, maintain on auth.identities to postgres with grant option;

-- ---------- supabase_migrations (columns only; live has 5 rows which are not copied)
create schema if not exists supabase_migrations authorization postgres;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text, created_by text, idempotency_key text, rollback text[]);
alter table supabase_migrations.schema_migrations owner to postgres;

-- ---------- public: created as role postgres (owner of every live public object)
set session authorization postgres;
create table public.languages (id uuid not null default gen_random_uuid(), code text not null, name text not null, name_native text not null, flag_emoji text not null,
  is_live boolean not null default false, created_at timestamptz default now(), constraint languages_pkey primary key (id), constraint languages_code_key unique (code));
create table public.weeks (id uuid not null default gen_random_uuid(), language_id uuid not null, number integer not null, title text not null, phase text not null, description text not null,
  constraint weeks_pkey primary key (id), constraint weeks_language_id_number_key unique (language_id, number), constraint weeks_language_id_fkey foreign key (language_id) references public.languages (id) on delete cascade);
create table public.lessons (id text not null, week_id uuid not null, language_id uuid not null, session integer not null, title text not null, title_native text not null, description text not null,
  tags text[] not null default '{}'::text[], estimated_minutes integer not null, vocabulary jsonb not null default '[]'::jsonb, grammar jsonb not null default '[]'::jsonb,
  phrases jsonb not null default '[]'::jsonb, quiz jsonb not null default '[]'::jsonb, cultural_note jsonb, pronunciation_tip jsonb, created_at timestamptz default now(), updated_at timestamptz default now(),
  constraint lessons_pkey primary key (id), constraint lessons_language_id_id_key unique (language_id, id),
  constraint lessons_language_id_fkey foreign key (language_id) references public.languages (id) on delete cascade,
  constraint lessons_week_id_fkey foreign key (week_id) references public.weeks (id) on delete cascade);
create index idx_lessons_language on public.lessons using btree (language_id);
create index idx_lessons_week on public.lessons using btree (week_id);
create table public.lessons_backup_20261021 (id text, week_id uuid, language_id uuid, session integer, title text, title_native text, description text, tags text[], estimated_minutes integer,
  vocabulary jsonb, grammar jsonb, phrases jsonb, quiz jsonb, cultural_note jsonb, pronunciation_tip jsonb, created_at timestamptz, updated_at timestamptz);
create table public.user_progress (user_id uuid not null, lesson_id text not null, language_code text not null, quiz_score integer, completed_at timestamptz not null default now(),
  constraint user_progress_pkey primary key (user_id, lesson_id), constraint user_progress_quiz_score_check check (((quiz_score >= 0) and (quiz_score <= 100))),
  constraint user_progress_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade);
create index user_progress_user_language_idx on public.user_progress using btree (user_id, language_code);
create table public.user_settings (user_id uuid not null, daily_goal_minutes integer not null default 10, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint user_settings_pkey primary key (user_id), constraint user_settings_daily_goal_minutes_check check ((daily_goal_minutes = any (array[5, 10, 15, 20, 30]))),
  constraint user_settings_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade);
create table public.daily_activity (user_id uuid not null, activity_date date not null, seconds_studied integer not null default 0, goal_minutes integer not null, updated_at timestamptz not null default now(),
  constraint daily_activity_pkey primary key (user_id, activity_date), constraint daily_activity_goal_minutes_check check ((goal_minutes > 0)), constraint daily_activity_seconds_studied_check check ((seconds_studied >= 0)),
  constraint daily_activity_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade);
create table public.saved_lessons (user_id uuid not null, lesson_id text not null, language_code text not null, saved_at timestamptz not null default now(),
  constraint saved_lessons_pkey primary key (user_id, lesson_id), constraint saved_lessons_lesson_id_fkey foreign key (lesson_id) references public.lessons (id) on delete cascade,
  constraint saved_lessons_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade);
create table public.chess_events (id bigint generated always as identity not null, created_at timestamptz not null default now(), client_ts timestamptz, session_id text not null, device_id text,
  game_id text, kind text not null, data jsonb not null default '{}'::jsonb, app_version text, user_agent text, constraint chess_events_pkey primary key (id));
create index chess_events_created_at_idx on public.chess_events using btree (created_at desc);
create index chess_events_game_idx on public.chess_events using btree (game_id, client_ts);
create index chess_events_kind_idx on public.chess_events using btree (kind, created_at desc);
create table public.chess_frames (id bigint generated always as identity not null, created_at timestamptz not null default now(), session_id text not null, device_id text, game_id text,
  reason text not null, meta jsonb not null default '{}'::jsonb, base_jpeg text, cur_jpeg text, app_version text, constraint chess_frames_pkey primary key (id));
create index chess_frames_created_at_idx on public.chess_frames using btree (created_at desc);

CREATE OR REPLACE FUNCTION public.chess_frames_prune()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from public.chess_frames
  where id < (select min(id) from (select id from public.chess_frames order by id desc limit 300) t);
  return null;
end $function$;
CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;
CREATE TRIGGER chess_frames_prune_trg AFTER INSERT ON public.chess_frames FOR EACH STATEMENT EXECUTE FUNCTION chess_frames_prune();
CREATE TRIGGER daily_activity_updated_at BEFORE UPDATE ON public.daily_activity FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER lessons_updated_at BEFORE UPDATE ON public.lessons FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER user_settings_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

create view public.lesson_summaries with (security_invoker = true) as
 SELECT l.id, l.session, l.title, l.title_native, l.description, l.tags, l.estimated_minutes,
    w.number AS week_number, w.title AS week_title, w.phase AS week_phase, w.description AS week_description, lang.code AS language_code
   FROM ((lessons l JOIN weeks w ON ((l.week_id = w.id))) JOIN languages lang ON ((l.language_id = lang.id)));

-- RLS (live: all 9 tables enabled, none forced)
alter table public.languages enable row level security; alter table public.weeks enable row level security; alter table public.lessons enable row level security;
alter table public.lessons_backup_20261021 enable row level security; alter table public.user_progress enable row level security; alter table public.user_settings enable row level security;
alter table public.daily_activity enable row level security; alter table public.saved_lessons enable row level security; alter table public.chess_events enable row level security; alter table public.chess_frames enable row level security;
create policy "Public read: languages" on public.languages for select to public using (true);
create policy "Public read: weeks" on public.weeks for select to public using (true);
create policy "Public read: lessons" on public.lessons for select to public using (true);
create policy "Users manage own progress" on public.user_progress for all to authenticated using (((select auth.uid() as uid) = user_id)) with check (((select auth.uid() as uid) = user_id));
create policy "Users manage own settings" on public.user_settings for all to authenticated using (((select auth.uid() as uid) = user_id)) with check (((select auth.uid() as uid) = user_id));
create policy "Users manage own activity" on public.daily_activity for all to authenticated using (((select auth.uid() as uid) = user_id)) with check (((select auth.uid() as uid) = user_id));
create policy "Users manage own saved lessons" on public.saved_lessons for all to authenticated using (((select auth.uid() as uid) = user_id)) with check (((select auth.uid() as uid) = user_id));

-- table/sequence/function ACLs exactly as live (the image's default ACLs may have granted more; normalise to live)
do $$ declare r record; begin
  for r in select c.oid::regclass as t, c.relkind from pg_class c where relnamespace='public'::regnamespace and relkind in ('r','v','S') loop
    execute format('revoke all on %s %s from anon, authenticated, service_role', case when r.relkind='S' then 'sequence' else 'table' end, r.t);
  end loop; end $$;
grant all on public.languages, public.weeks, public.lessons, public.lesson_summaries, public.chess_events, public.chess_frames to anon;
grant all on public.languages, public.weeks, public.lessons, public.lesson_summaries, public.chess_events, public.chess_frames, public.daily_activity, public.saved_lessons, public.user_progress, public.user_settings to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select, update on public.chess_events_id_seq, public.chess_frames_id_seq to anon, authenticated, service_role;
reset session authorization;
