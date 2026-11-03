// A stand-in for the SHARED Supabase project (ywcrzkvwamjchjjkfrve) in a real Postgres (pglite): the Supabase roles, the bits of
// `auth` that Fanday reads, and `public` tables with the names, user_id columns and RLS policies of Woofabulary and Chess Tutor
// (as described in the README, "Anonymous sign-ins: effect on other apps", read-only check of 2026-11-03).
// Column lists beyond user_id are minimal on purpose: only names, user_id and policy shape matter to Fanday's migrations.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const read = (f) => readFileSync(fileURLToPath(new URL(`../../supabase/${f}`, import.meta.url)), 'utf8')
export const U = {
  A: '11111111-1111-1111-1111-111111111111', B: '22222222-2222-2222-2222-222222222222',
  C: '33333333-3333-3333-3333-333333333333', D: '44444444-4444-4444-4444-444444444444',
}
export const ok = (() => { let fails = 0; const f = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${cond ? '' : extra}`) }; f.fails = () => fails; return f })()

export async function makeStandIn() {
  const db = new PGlite()
  await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema auth; grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, is_anonymous boolean not null default false,
  raw_app_meta_data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null, identity_data jsonb not null default '{}'::jsonb);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Woofabulary (public read for content; own-row ALL policies for user data) and Chess Tutor (RLS on, no policies).
create table public.languages (id serial primary key, code text not null);
create table public.weeks (id serial primary key, language_id int references public.languages (id), n int);
create table public.lessons (id serial primary key, week_id int references public.weeks (id), title text);
create table public.lessons_backup_20261021 (id int, title text);
create table public.user_progress (id serial primary key, user_id uuid not null, lesson_id int, done boolean default false);
create table public.user_settings (user_id uuid primary key, settings jsonb, updated_at timestamptz);
create table public.daily_activity (id serial primary key, user_id uuid not null, day date, n int);
create table public.saved_lessons (id serial primary key, user_id uuid not null, lesson_id int);
create view public.lesson_summaries as select l.id, l.title, w.n as week from public.lessons l left join public.weeks w on w.id = l.week_id;
create table public.chess_events (id serial primary key, user_id text, kind text);   -- text user_id on purpose
create table public.chess_frames (id serial primary key, user_id uuid, frame jsonb);

create function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger user_settings_touch before update on public.user_settings for each row execute function public.touch_updated_at();

alter table public.languages enable row level security; alter table public.weeks enable row level security; alter table public.lessons enable row level security;
alter table public.user_progress enable row level security; alter table public.user_settings enable row level security;
alter table public.daily_activity enable row level security; alter table public.saved_lessons enable row level security;
alter table public.chess_events enable row level security; alter table public.chess_frames enable row level security;
create policy languages_read on public.languages for select to anon, authenticated using (true);
create policy weeks_read on public.weeks for select to anon, authenticated using (true);
create policy lessons_read on public.lessons for select to anon, authenticated using (true);
create policy user_progress_own on public.user_progress for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy user_settings_own on public.user_settings for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy daily_activity_own on public.daily_activity for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy saved_lessons_own on public.saved_lessons for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select on public.languages, public.weeks, public.lessons, public.lesson_summaries to anon, authenticated;
grant select, insert, update, delete on public.user_progress, public.user_settings, public.daily_activity, public.saved_lessons to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role, authenticated;

insert into public.languages (code) values ('es'), ('fr');
insert into public.weeks (language_id, n) values (1, 1);
insert into public.lessons (week_id, title) values (1, 'Hola');
`)
  return db
}

/** Run SQL as a role + user; resets after. Returns { rows } or { error }. */
export function asFactory(db) {
  return async function as(role, uid, sql) {
    await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`)
    try { return { rows: (await db.query(sql)).rows } }
    catch (e) { return { error: e.message } }
    finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
  }
}

/**
 * Everything observable OUTSIDE schema `fanday`, as one JSON string: schemas and their ACLs, relations (kind, owner, RLS flags, ACL),
 * columns, constraints, indexes, policies, functions (source, ACL), triggers (including the system ones, by table), default privileges,
 * roles, extensions, and a content hash of every table outside fanday. If any Fanday statement touched anything else, this changes.
 */
export async function catalogSnapshot(db) {
  const q = async (sql) => (await db.query(sql)).rows
  const notSys = `n.nspname not in ('fanday','pg_catalog','information_schema') and n.nspname not like 'pg\\_%'`
  const snap = {
    schemas: await q(`select n.nspname, pg_get_userbyid(n.nspowner) owner, n.nspacl::text acl from pg_namespace n where ${notSys} order by 1`),
    relations: await q(`select n.nspname, c.relname, c.relkind, pg_get_userbyid(c.relowner) owner, c.relrowsecurity rls, c.relforcerowsecurity frls, c.relacl::text acl, c.reloptions::text opts
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where ${notSys} order by 1,2`),
    columns: await q(`select n.nspname, c.relname, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) typ, a.attnotnull, a.attacl::text acl, pg_get_expr(d.adbin, d.adrelid) dflt, a.attidentity, a.attgenerated
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attnum > 0 and not a.attisdropped and ${notSys} order by 1,2,3`),
    constraints: await q(`select n.nspname, c.relname, k.conname, k.contype, pg_get_constraintdef(k.oid) def
      from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace where ${notSys} order by 1,2,3`),
    foreign_keys_into_outside: await q(`select k.conname, pg_get_constraintdef(k.oid) def from pg_constraint k
      join pg_class t on t.oid = k.confrelid join pg_namespace tn on tn.oid = t.relnamespace
      join pg_class s on s.oid = k.conrelid join pg_namespace sn on sn.oid = s.relnamespace
      where sn.nspname = 'fanday' and tn.nspname <> 'fanday' order by 1`),
    indexes: await q(`select schemaname, tablename, indexname, indexdef from pg_indexes where schemaname not in ('fanday','pg_catalog','information_schema') and schemaname not like 'pg\\_%' order by 1,2,3`),
    policies: await q(`select schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check from pg_policies where schemaname <> 'fanday' order by 1,2,3`),
    functions: await q(`select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args, pg_get_userbyid(p.proowner) owner, p.prosecdef, p.proconfig::text cfg, p.proacl::text acl, md5(p.prosrc) src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where ${notSys} order by 1,2,3`),
    // Every trigger on a table outside fanday, system (foreign-key) triggers included, counted per table and named by function.
    triggers: await q(`select n.nspname, c.relname, t.tgisinternal internal, t.tgtype, t.tgenabled, t.tgfoid::regproc::text fn, count(*)::int n
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where ${notSys} group by 1,2,3,4,5,6 order by 1,2,3,4,5,6`),
    default_acls: await q(`select pg_get_userbyid(defaclrole) role, defaclnamespace::regnamespace::text ns, defaclobjtype, defaclacl::text acl from pg_default_acl order by 1,2,3`),
    roles: await q(`select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls from pg_roles where rolname not like 'pg\\_%' order by 1`),
    memberships: await q(`select pg_get_userbyid(roleid) r, pg_get_userbyid(member) m from pg_auth_members order by 1,2`),
    extensions: await q(`select extname, extversion, extnamespace::regnamespace::text ns from pg_extension order by 1`),
    types: await q(`select n.nspname, t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace where ${notSys} and t.typtype in ('e','d','c') and t.typrelid = 0 order by 1,2`),
    sequences: await q(`select schemaname, sequencename, last_value from pg_sequences where schemaname <> 'fanday' order by 1,2`),
  }
  // Row content of every ordinary table outside fanday (and the system-owned ones we stand in for).
  snap.data = {}
  for (const r of snap.relations.filter((x) => x.relkind === 'r')) {
    const t = `"${r.nspname}"."${r.relname}"`
    snap.data[`${r.nspname}.${r.relname}`] = (await q(`select count(*)::int n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) h from ${t} x`))[0]
  }
  return JSON.stringify(snap)
}
