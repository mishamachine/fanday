// Proves RLS in 0001_init.sql with a real Postgres (pglite): users can't see each other's follows/devices/profile,
// reference data is read-only, link_clicks is server-only, and the anonymous -> signed-in follow merge is safe.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (f) => readFileSync(fileURLToPath(new URL(`../../supabase/${f}`, import.meta.url)), 'utf8')
const db = new PGlite()
const A = '11111111-1111-1111-1111-111111111111' // signed-in user A
const B = '22222222-2222-2222-2222-222222222222' // signed-in user B
const ANON = '33333333-3333-3333-3333-333333333333' // anonymous user
const ANON2 = '44444444-4444-4444-4444-444444444444' // another anonymous user
let fails = 0
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${cond ? '' : extra}`) }

// Minimal Supabase surroundings: roles, auth.users (with is_anonymous), auth.uid().
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema auth; grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, is_anonymous boolean not null default false);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
`)
await db.exec(read('migrations/0001_init.sql'))
await db.exec(read('seed.sql'))
await db.exec(read('seed.sql')) // idempotent
await db.exec(read('seed_teams.sql')); await db.exec(read('seed_teams.sql')) // loads into the real schema, idempotent
ok('teams seed: 434 rows, every league FK valid, Arsenal once per league', (await db.query('select count(*)::int c from public.teams')).rows[0].c === 434
  && (await db.query(`select count(*)::int c from public.teams where id in ('epl-arsenal','ucl-arsenal')`)).rows[0].c === 2)
ok('teams seed: NBA/NHL have no wiki_page; every other seeded team has one', (await db.query(`select count(*)::int c from public.teams where (league_id in ('nba','nhl')) <> (wiki_page is null)`)).rows[0].c === 0)
await db.exec(`
insert into auth.users (id, email, is_anonymous) values ('${A}','a@x.com',false), ('${B}','b@x.com',false), ('${ANON}',null,true), ('${ANON2}',null,true);
insert into public.teams (id, league_id, name, short_name) values ('nfl-kc','nfl','Chiefs','KC'), ('nfl-den','nfl','Broncos','DEN'), ('epl-ars','epl','Arsenal','ARS');
insert into public.games (id, league_id, home_team_id, away_team_id, game_date, kickoff_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001','nfl','nfl-kc','nfl-den','2026-11-08','2026-11-08T20:20:00Z');
insert into public.follows (user_id, team_id) values ('${A}','nfl-kc'), ('${B}','epl-ars');
insert into public.devices (id, user_id, platform) values ('bbbbbbbb-0000-0000-0000-00000000000a','${A}','ios'), ('bbbbbbbb-0000-0000-0000-00000000000b','${B}','android');
insert into public.device_events (device_id, game_id, event_identifier) values
  ('bbbbbbbb-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','EV-A'), ('bbbbbbbb-0000-0000-0000-00000000000b','aaaaaaaa-0000-0000-0000-000000000001','EV-B');
`)

// Run SQL as a role + user. Always resets the role after.
async function as(role, uid, sql) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`)
  try { return { rows: (await db.query(sql)).rows } }
  catch (e) { return { error: e.message } }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
const n = async (role, uid, sql) => { const r = await as(role, uid, sql); return r.error ? `ERR:${r.error}` : r.rows.length }

ok('seed: 19 leagues, idempotent', (await db.query('select count(*)::int c from public.leagues')).rows[0].c === 19)
ok('seed: off-season leagues flagged', (await db.query(`select string_agg(id, ',' order by id) s from public.leagues where not in_season`)).rows[0].s === 'ipl,mlb,nrl,wnba')
ok('trigger created profiles for every auth user', (await db.query('select count(*)::int c from public.profiles')).rows[0].c === 4)

// ---- the headline: one user cannot read another user's follows, devices or profile
ok('A sees only own follows', (await as('authenticated', A, 'select user_id from public.follows')).rows.every((r) => r.user_id === A) && await n('authenticated', A, 'select 1 from public.follows') === 1)
ok('A cannot read B follows by filter', await n('authenticated', A, `select 1 from public.follows where user_id='${B}'`) === 0)
ok('A sees only own devices', await n('authenticated', A, 'select 1 from public.devices') === 1)
ok('A cannot read B devices by filter', await n('authenticated', A, `select 1 from public.devices where user_id='${B}'`) === 0)
ok('A sees only own device_events', (await as('authenticated', A, 'select event_identifier e from public.device_events')).rows.map((r) => r.e).join() === 'EV-A')
ok('A sees only own profile', (await as('authenticated', A, 'select user_id from public.profiles')).rows.map((r) => r.user_id).join() === A)
ok('A cannot read B profile by filter', await n('authenticated', A, `select 1 from public.profiles where user_id='${B}'`) === 0)
ok('anon (not signed in) sees no follows/devices/profiles', await n('anon', null, 'select 1 from public.follows') === 'ERR:permission denied for table follows'
  && String(await n('anon', null, 'select 1 from public.profiles')).startsWith('ERR:'))

// ---- cross-user writes are refused
ok('A cannot insert a follow for B', (await as('authenticated', A, `insert into public.follows (user_id, team_id) values ('${B}','nfl-den')`)).error?.includes('row-level security'))
ok('A cannot delete B follow', (await as('authenticated', A, `delete from public.follows where user_id='${B}' returning 1`)).rows?.length === 0)
ok('A cannot attach a device to B', (await as('authenticated', A, `insert into public.devices (user_id, platform) values ('${B}','ios')`)).error?.includes('row-level security'))
ok('A cannot add a device_event to B device', (await as('authenticated', A, `insert into public.device_events (device_id, game_id, event_identifier) values ('bbbbbbbb-0000-0000-0000-00000000000b','aaaaaaaa-0000-0000-0000-000000000001','X')`)).error?.includes('row-level security'))
ok('A cannot update B profile', (await as('authenticated', A, `update public.profiles set country='ZZ' where user_id='${B}' returning 1`)).rows?.length === 0)
ok('A can update own profile prefs', (await as('authenticated', A, `update public.profiles set promo_push_opt_in=true, country='US' where user_id='${A}' returning 1`)).rows?.length === 1)
ok('A cannot unlock Pro on own profile', !!(await as('authenticated', A, `update public.profiles set pro_unlocked=true where user_id='${A}'`)).error)
ok('A cannot rewrite own profile email', !!(await as('authenticated', A, `update public.profiles set email='evil@x.com' where user_id='${A}'`)).error)
ok('A can add own follow and usage event', (await as('authenticated', A, `insert into public.follows (user_id, team_id) values ('${A}','nfl-den') returning 1`)).rows?.length === 1
  && (await as('authenticated', A, `insert into public.usage_events (user_id, name) values ('${A}','open') returning 1`)).rows?.length === 1)
ok('A cannot write usage event as B', (await as('authenticated', A, `insert into public.usage_events (user_id, name) values ('${B}','open')`)).error?.includes('row-level security'))
ok('A cannot read B usage events', await n('authenticated', A, `select 1 from public.usage_events where user_id='${B}'`) === 0)

// ---- reference tables: readable by anon + authenticated, writable by service_role only
for (const t of ['leagues', 'teams', 'games', 'sponsors', 'game_changes']) {
  ok(`${t}: readable by anon and authenticated`, typeof await n('anon', null, `select 1 from public.${t}`) === 'number' && typeof await n('authenticated', A, `select 1 from public.${t}`) === 'number')
}
ok('anon can read games', await n('anon', null, 'select 1 from public.games') === 1)
ok('authenticated cannot write games', !!(await as('authenticated', A, `update public.games set venue='x'`)).error)
ok('anon cannot write teams', !!(await as('anon', null, `insert into public.teams (id, league_id, name, short_name) values ('x','nfl','X','X')`)).error)
ok('authenticated cannot write leagues', !!(await as('authenticated', A, `delete from public.leagues`)).error)
ok('authenticated cannot write sponsors', !!(await as('authenticated', A, `insert into public.sponsors (scope_type, scope_value, text) values ('league','nfl','x')`)).error)
ok('authenticated cannot write game_changes', !!(await as('authenticated', A, `insert into public.game_changes (game_id, field) values ('aaaaaaaa-0000-0000-0000-000000000001','venue')`)).error)
await db.exec(`set role service_role`)
let svcErr = null
try {
  await db.exec(`
  insert into public.sponsors (id, scope_type, scope_value, text, push_eligible) values ('cccccccc-0000-0000-0000-000000000001','league','nfl','Acme',false);
  update public.games set watch_provider='x', watch_url='https://example.com/w', tickets_url='https://example.com/t', sponsor_id='cccccccc-0000-0000-0000-000000000001', sponsor_text='Acme', sponsor_url='https://example.com/s';
  insert into public.game_changes (game_id, field, old_value, new_value) values ('aaaaaaaa-0000-0000-0000-000000000001','kickoff_at','19:20','20:20');`)
} catch (e) { svcErr = e.message }
await db.exec(`reset role`)
ok('service_role writes games, sponsors and game_changes', !svcErr, svcErr ?? '')

// ---- link_clicks: server only
ok('link_clicks: authenticated cannot read or write', String(await n('authenticated', A, 'select 1 from public.link_clicks')).startsWith('ERR:')
  && !!(await as('authenticated', A, `insert into public.link_clicks (game_id, slot) values ('aaaaaaaa-0000-0000-0000-000000000001','watch')`)).error)
ok('link_clicks: anon cannot write', !!(await as('anon', null, `insert into public.link_clicks (game_id, slot) values ('aaaaaaaa-0000-0000-0000-000000000001','watch')`)).error)
await db.exec(`set role service_role`)
await db.query(`select public.record_link_click('aaaaaaaa-0000-0000-0000-000000000001','watch')`)
await db.query(`select public.record_link_click('aaaaaaaa-0000-0000-0000-000000000001','watch')`)
await db.query(`select public.record_link_click('aaaaaaaa-0000-0000-0000-000000000001','tickets')`)
const bogus = await db.query(`select public.record_link_click('aaaaaaaa-0000-0000-0000-000000000001','bogus')`).then(() => null, (e) => e.message)
await db.exec(`reset role`)
ok('link_clicks: record_link_click upserts one counter row per game+slot+day', JSON.stringify((await db.query(`select slot, clicks from public.link_clicks order by slot`)).rows) === JSON.stringify([{ slot: 'tickets', clicks: 1 }, { slot: 'watch', clicks: 2 }]))
ok('link_clicks: slot still constrained', !!bogus)
ok('record_link_click is not callable by users', !!(await as('authenticated', A, `select public.record_link_click('aaaaaaaa-0000-0000-0000-000000000001','watch')`)).error
  && !!(await as('anon', null, `select public.record_link_click('aaaaaaaa-0000-0000-0000-000000000001','watch')`)).error)
ok('link_clicks stores no person columns', (await db.query(`select string_agg(column_name, ',' order by column_name) c from information_schema.columns where table_name='link_clicks'`)).rows[0].c === 'clicks,day,game_id,slot')

// ---- anonymous -> signed-in: follows survive
await db.exec(`insert into public.follows (user_id, team_id) values ('${ANON}','nfl-kc'), ('${ANON}','epl-ars');
insert into public.devices (user_id, platform) values ('${ANON}','ios');`)
ok('signed-in user cannot start a merge claim', !!(await as('authenticated', A, 'select public.create_merge_claim()')).error)
ok('anon (no JWT user) cannot call merge functions', !!(await as('anon', null, 'select public.create_merge_claim()')).error)
const tok = (await as('authenticated', ANON, 'select public.create_merge_claim() t')).rows[0].t
ok('anonymous user gets a claim token', /^[0-9a-f-]{36}$/.test(tok))
ok('claim table is not readable by users', String(await n('authenticated', ANON, 'select 1 from public.merge_claims')).startsWith('ERR:'))
ok('another anonymous user cannot redeem it', !!(await as('authenticated', ANON2, `select public.claim_anonymous_follows('${tok}')`)).error)
ok('B cannot steal A-bound claim by guessing a random token', !!(await as('authenticated', B, `select public.claim_anonymous_follows(gen_random_uuid())`)).error)
const r = await as('authenticated', B, `select public.claim_anonymous_follows('${tok}') r`)
ok('signed-in B redeems: new follow moved (epl-ars was already followed by B), device moved', r.rows?.[0]?.r?.moved_follows === 1 && r.rows[0].r.moved_devices === 1, JSON.stringify(r))
ok('B now has anon follows plus own; anon has none', (await db.query(`select user_id, count(*)::int c from public.follows where user_id in ('${B}','${ANON}') group by 1 order by 1`)).rows.map((x) => `${x.user_id.slice(0, 2)}:${x.c}`).join() === '22:2')
ok('token is single use', !!(await as('authenticated', B, `select public.claim_anonymous_follows('${tok}')`)).error)
const tok2 = (await as('authenticated', ANON2, 'select public.create_merge_claim() t')).rows[0].t
await db.exec(`update public.merge_claims set expires_at = now() - interval '1 minute' where token = '${tok2}'`)
ok('expired claim is rejected', !!(await as('authenticated', A, `select public.claim_anonymous_follows('${tok2}')`)).error)
const tok3 = (await as('authenticated', ANON2, 'select public.create_merge_claim() t')).rows[0].t
ok('anonymous user cannot redeem (must be signed in)', !!(await as('authenticated', ANON, `select public.claim_anonymous_follows('${tok3}')`)).error)
await db.exec(`update auth.users set is_anonymous = false where id = '${ANON2}'`)
ok('claim whose source is no longer anonymous is rejected', !!(await as('authenticated', A, `select public.claim_anonymous_follows('${tok3}')`)).error)
await db.exec(`update auth.users set is_anonymous = true where id = '${ANON2}'`)

// ---- sponsors: only active ones (starts_on/ends_on, inclusive) are visible to clients
await db.exec(`insert into public.sponsors (id, scope_type, scope_value, text, starts_on, ends_on) values
  ('cccccccc-0000-0000-0000-000000000002','league','nfl','Expired', current_date - 10, current_date - 1),
  ('cccccccc-0000-0000-0000-000000000003','league','nfl','Future', current_date + 1, null),
  ('cccccccc-0000-0000-0000-000000000004','league','nfl','EndsToday', null, current_date),
  ('cccccccc-0000-0000-0000-000000000005','league','nfl','StartsToday', current_date, current_date + 5)`)
const vis = async (role, uid) => (await as(role, uid, 'select text from public.sponsors order by text')).rows.map((r) => r.text).join()
ok('sponsors: anon sees only active (no expired, no future)', await vis('anon', null) === 'Acme,EndsToday,StartsToday', await vis('anon', null))
ok('sponsors: authenticated sees the same', await vis('authenticated', B) === 'Acme,EndsToday,StartsToday')
ok('sponsors: service_role sees all', (await db.query('select count(*)::int c from public.sponsors')).rows[0].c === 5)

// ---- cleanup of merged anonymous users (7 days after the claim was redeemed)
const rows = async () => (await db.query(`select id from auth.users where id in ('${ANON}','${ANON2}') order by id`)).rows.map((r) => r.id)
ok('before cleanup both anonymous users exist', (await rows()).length === 2)
await db.exec(`set role service_role`)
const c1 = (await db.query('select public.cleanup_merged_anonymous_users() n')).rows[0].n
await db.exec(`reset role`)
ok('cleanup: a claim redeemed today does not delete its anonymous user yet', c1 === 0 && (await rows()).length === 2)
await db.exec(`update public.merge_claims set redeemed_at = now() - interval '8 days' where from_user = '${ANON}'`)
await db.exec(`update public.merge_claims set redeemed_at = now() - interval '8 days' where from_user = '${B}'`) // not anonymous: must survive
await db.exec(`insert into public.merge_claims (from_user, redeemed_at) values ('${B}', now() - interval '9 days')`)
await db.exec(`set role service_role`)
const c2 = (await db.query('select public.cleanup_merged_anonymous_users() n')).rows[0].n
await db.exec(`reset role`)
ok('cleanup: deletes the merged anonymous user after 7 days', c2 === 1 && (await rows()).join() === ANON2)
ok('cleanup: never deletes a non-anonymous user', (await db.query(`select 1 from auth.users where id='${B}'`)).rows.length === 1)
ok('cleanup: cascaded the anonymous user rows', (await db.query(`select (select count(*) from public.devices where user_id='${ANON}')::int d`)).rows[0].d === 0)
ok('cleanup is not callable by users', !!(await as('authenticated', B, 'select public.cleanup_merged_anonymous_users()')).error)

// ---- profile email follows auth.users; delete cascades everything (what delete-account relies on)
await db.exec(`update auth.users set email='a2@x.com' where id='${A}'`)
ok('profile email follows auth.users email', (await db.query(`select email from public.profiles where user_id='${A}'`)).rows[0].email === 'a2@x.com')
await db.exec(`delete from auth.users where id='${A}'`)
const left = (await db.query(`select (select count(*) from public.follows where user_id='${A}')::int + (select count(*) from public.devices where user_id='${A}')::int + (select count(*) from public.profiles where user_id='${A}')::int + (select count(*) from public.usage_events where user_id='${A}')::int + (select count(*) from public.device_events where event_identifier='EV-A')::int c`)).rows[0].c
ok('deleting the auth user cascades all of A\'s rows', left === 0)
ok('...and leaves B and reference data alone', (await db.query(`select (select count(*) from public.follows where user_id='${B}')::int f, (select count(*) from public.games)::int g`)).rows[0].f === 2)

console.log(fails ? `\n${fails} FAILED` : '\nall migration checks passed')
process.exit(fails ? 1 : 0)
