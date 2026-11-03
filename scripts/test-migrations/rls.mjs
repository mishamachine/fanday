// Fanday behaviour on the shared-project stand-in (real Postgres via pglite): RLS for signed-in users, the closed device-owned rows,
// the device-token RPCs (isolation, wrong/revoked tokens, delete), claim_device (move, single use, mismatch, other user), lazy profiles,
// rate limits, cleanup. Schema `fanday` only; the catalog-unchanged proof is in shared-project.mjs.
import { makeStandIn, asFactory, read, U, ok } from './standin.mjs'

const db = await makeStandIn()
const as = asFactory(db)
const { A, B, C, D } = U
const T1 = 'a'.repeat(64), T2 = 'b'.repeat(64), T3 = 'c'.repeat(64), T4 = 'd'.repeat(64)
const G1 = 'aaaaaaaa-0000-0000-0000-000000000001'
const DEV1 = 'dddddddd-0000-0000-0000-000000000001', DEV2 = 'dddddddd-0000-0000-0000-000000000002'

for (const f of ['migrations/fanday_0001_init.sql', 'migrations/fanday_0002_ingest.sql', 'seed.sql', 'seed_teams.sql', 'seed/teams_tz.sql']) await db.exec(read(f))
await db.exec(`
insert into auth.users (id, email) values ('${A}','a@x.com'), ('${B}','b@x.com'), ('${C}','c@x.com'), ('${D}','d@x.com');
insert into fanday.teams (id, league_id, name, short_name) values ('nfl-kc-x','nfl','Chiefs','KC'), ('nfl-den-x','nfl','Broncos','DEN');
insert into fanday.games (id, league_id, home_team_id, away_team_id, game_date, kickoff_at) values ('${G1}','nfl','nfl-kc-x','nfl-den-x','2026-11-08','2026-11-08T20:20:00Z');
`)
const n = async (role, uid, sql) => { const r = await as(role, uid, sql); return r.error ? `ERR:${r.error}` : r.rows.length }
const svc = async (sql) => as('service_role', null, sql)
const reg = async (t) => (await svc(`select fanday.register_device_token(sha256(convert_to('${t}','UTF8'))) id`)).rows[0].id

ok('seed: 19 leagues, 434 teams, off-season flagged', (await db.query('select count(*)::int c from fanday.leagues')).rows[0].c === 19
  && (await db.query(`select string_agg(id, ',' order by id) s from fanday.leagues where not in_season`)).rows[0].s === 'ipl,mlb,nrl,wnba')
ok('no profile exists until the app asks (no trigger)', (await db.query('select count(*)::int c from fanday.profiles')).rows[0].c === 0)

// ---- lazy profiles
ok('ensure_profile: signed-out role cannot call it', !!(await as('anon', null, 'select fanday.ensure_profile()')).error)
ok('ensure_profile creates the caller profile only, with the auth email', !(await as('authenticated', A, 'select fanday.ensure_profile()')).error
  && (await db.query(`select string_agg(user_id::text||':'||email, ',') s from fanday.profiles`)).rows[0].s === `${A}:a@x.com`)
await as('authenticated', A, 'select fanday.ensure_profile()')
await as('authenticated', B, 'select fanday.ensure_profile()')
ok('ensure_profile is repeatable (one row per user)', (await db.query('select count(*)::int c from fanday.profiles')).rows[0].c === 2)
await db.exec(`update auth.users set email='a2@x.com' where id='${A}'`); await as('authenticated', A, 'select fanday.ensure_profile()')
ok('ensure_profile refreshes the email', (await db.query(`select email from fanday.profiles where user_id='${A}'`)).rows[0].email === 'a2@x.com')
ok('A sees only own profile', (await as('authenticated', A, 'select user_id from fanday.profiles')).rows.map((r) => r.user_id).join() === A)
ok('A cannot read or update B profile', await n('authenticated', A, `select 1 from fanday.profiles where user_id='${B}'`) === 0
  && (await as('authenticated', A, `update fanday.profiles set country='ZZ' where user_id='${B}' returning 1`)).rows?.length === 0)
ok('A can set prefs; cannot unlock Pro or rewrite email', (await as('authenticated', A, `update fanday.profiles set promo_push_opt_in=true, country='US' where user_id='${A}' returning 1`)).rows?.length === 1
  && !!(await as('authenticated', A, `update fanday.profiles set pro_unlocked=true where user_id='${A}'`)).error
  && !!(await as('authenticated', A, `update fanday.profiles set email='evil@x.com' where user_id='${A}'`)).error)

// ---- origin: who created the auth user (kept inside fanday)
const mkUser = async (n, { age = '0 minutes', providers = ['google'] } = {}) => {
  const id = `${n}${n}${n}${n}${n}${n}${n}${n}-0000-4000-8000-00000000000${n}`
  await db.exec(`insert into auth.users (id, email, created_at) values ('${id}','o${n}@x.com', now() - interval '${age}');
    ${providers.map((p) => `insert into auth.identities (user_id, provider) values ('${id}','${p}');`).join('')}`)
  return id
}
const origin = async (id) => (await db.query(`select created_by_fanday c from fanday.user_origin where user_id='${id}'`)).rows[0]?.c ?? null
const [O1, O2, O3, O4, O5, O6] = [await mkUser(1), await mkUser(2, { age: '1 hour' }), await mkUser(3), await mkUser(4, { providers: ['google', 'email'] }), await mkUser(5, { providers: ['apple'] }), await mkUser(6, { providers: ['email'] })]
await db.exec(`insert into public.user_progress (user_id, lesson_id) values ('${O3}', 1)`)
for (const o of [O1, O2, O3, O4, O5, O6]) await as('authenticated', o, 'select fanday.ensure_profile()')
ok('origin: brand-new Google user with no other rows -> created_by_fanday = true; brand-new Apple-only user -> true', (await origin(O1)) === true && (await origin(O5)) === true)
ok('origin: older than 10 minutes -> false', (await origin(O2)) === false)
ok('origin: has a Woofabulary row -> false', (await origin(O3)) === false)
ok('origin: identities beyond google/apple (email) -> false, also for an email-only user', (await origin(O4)) === false && (await origin(O6)) === false)
await db.exec(`insert into public.user_progress (user_id, lesson_id) values ('${O1}', 1)`)
await as('authenticated', O1, 'select fanday.ensure_profile()')
ok('origin: recorded once, never overwritten by a later call', (await origin(O1)) === true)
ok('origin: set_user_origin is service_role only and never overwrites', !!(await as('authenticated', O1, `select fanday.set_user_origin('${O1}', false)`)).error && !!(await as('anon', null, `select fanday.set_user_origin('${O1}', false)`)).error
  && !(await svc(`select fanday.set_user_origin('${O1}', false)`)).error && (await origin(O1)) === true
  && !(await svc(`select fanday.set_user_origin('99999999-0000-4000-8000-000000000009', true)`)).error && (await origin('99999999-0000-4000-8000-000000000009')) === true)
ok('origin: table is closed to clients', String(await n('authenticated', O1, 'select 1 from fanday.user_origin')).startsWith('ERR:') && String(await n('anon', null, 'select 1 from fanday.user_origin')).startsWith('ERR:'))
await db.exec(`delete from fanday.user_origin where user_id='99999999-0000-4000-8000-000000000009'; delete from fanday.profiles where user_id in ('${O1}','${O2}','${O3}','${O4}','${O5}','${O6}'); delete from fanday.user_origin where user_id in ('${O1}','${O2}','${O3}','${O4}','${O5}','${O6}')`)

// ---- signed-in RLS (tables)
await db.exec(`insert into fanday.follows (user_id, team_id) values ('${A}','nfl-kc-x'), ('${B}','nfl-den-x');
insert into fanday.devices (id, user_id, platform) values ('bbbbbbbb-0000-0000-0000-00000000000a','${A}','ios'), ('bbbbbbbb-0000-0000-0000-00000000000b','${B}','android');
insert into fanday.device_events (device_id, game_id, event_identifier) values ('bbbbbbbb-0000-0000-0000-00000000000a','${G1}','EV-A'), ('bbbbbbbb-0000-0000-0000-00000000000b','${G1}','EV-B');`)
ok('A sees only own follows / devices / events', await n('authenticated', A, 'select 1 from fanday.follows') === 1 && await n('authenticated', A, 'select 1 from fanday.devices') === 1
  && (await as('authenticated', A, 'select event_identifier e from fanday.device_events')).rows.map((r) => r.e).join() === 'EV-A')
ok('A cannot read B rows by filter', await n('authenticated', A, `select 1 from fanday.follows where user_id='${B}'`) === 0 && await n('authenticated', A, `select 1 from fanday.devices where user_id='${B}'`) === 0)
ok('A cannot write rows for B', (await as('authenticated', A, `insert into fanday.follows (user_id, team_id) values ('${B}','nfl-kc-x')`)).error?.includes('row-level security')
  && (await as('authenticated', A, `insert into fanday.devices (user_id, platform) values ('${B}','ios')`)).error?.includes('row-level security')
  && (await as('authenticated', A, `insert into fanday.device_events (device_id, game_id, event_identifier) values ('bbbbbbbb-0000-0000-0000-00000000000b','${G1}','X')`)).error?.includes('row-level security')
  && (await as('authenticated', A, `delete from fanday.follows where user_id='${B}' returning 1`)).rows?.length === 0)
ok('A can add own follow and usage event; not as B', (await as('authenticated', A, `insert into fanday.follows (user_id, team_id) values ('${A}','nfl-den-x') returning 1`)).rows?.length === 1
  && (await as('authenticated', A, `insert into fanday.usage_events (user_id, name) values ('${A}','open') returning 1`)).rows?.length === 1
  && (await as('authenticated', A, `insert into fanday.usage_events (user_id, name) values ('${B}','open')`)).error?.includes('row-level security'))
ok('signed-in users cannot create device-owned (no-user) rows', !!(await as('authenticated', A, `insert into fanday.follows (user_id, team_id) values (null,'nfl-kc-x')`)).error)
ok('anon cannot touch user tables', String(await n('anon', null, 'select 1 from fanday.follows')).startsWith('ERR:') && String(await n('anon', null, 'select 1 from fanday.profiles')).startsWith('ERR:'))

// ---- reference tables
for (const t of ['leagues', 'teams', 'games', 'sponsors', 'game_changes']) ok(`${t}: readable by anon and authenticated`, typeof await n('anon', null, `select 1 from fanday.${t}`) === 'number' && typeof await n('authenticated', A, `select 1 from fanday.${t}`) === 'number')
ok('reference tables are not writable by clients', !!(await as('authenticated', A, `update fanday.games set venue='x'`)).error && !!(await as('anon', null, `insert into fanday.teams (id, league_id, name, short_name) values ('x','nfl','X','X')`)).error
  && !!(await as('authenticated', A, `delete from fanday.leagues`)).error && !!(await as('authenticated', A, `insert into fanday.sponsors (scope_type, scope_value, text) values ('league','nfl','x')`)).error)
await db.exec(`insert into fanday.sponsors (scope_type, scope_value, text, starts_on, ends_on) values ('league','nfl','Expired', current_date-10, current_date-1), ('league','nfl','Future', current_date+1, null), ('league','nfl','EndsToday', null, current_date), ('league','nfl','StartsToday', current_date, current_date+5)`)
ok('sponsors: clients see only active ones', (await as('anon', null, 'select text from fanday.sponsors order by text')).rows.map((r) => r.text).join() === 'EndsToday,StartsToday')

// ---- device-owned rows are closed to direct access, open through token RPCs
const id1 = await reg(T1), id2 = await reg(T2)
ok('device_tokens: no client can read or write the table', String(await n('anon', null, 'select 1 from fanday.device_tokens')).startsWith('ERR:') && String(await n('authenticated', A, 'select 1 from fanday.device_tokens')).startsWith('ERR:')
  && !!(await as('anon', null, `insert into fanday.device_tokens (token_hash) values ('\\x00')`)).error)
ok('device_tokens stores only a hash (no plaintext column)', (await db.query(`select string_agg(column_name,',' order by column_name) c from information_schema.columns where table_schema='fanday' and table_name='device_tokens'`)).rows[0].c === 'claimed_at,claimed_by,created_at,id,last_used_at,revoked_at,token_hash'
  && (await db.query(`select count(*)::int c from fanday.device_tokens where token_hash = convert_to('${T1}','UTF8')`)).rows[0].c === 0)
ok('register_device_token is service_role only', !!(await as('anon', null, `select fanday.register_device_token('\\x01')`)).error && !!(await as('authenticated', A, `select fanday.register_device_token('\\x01')`)).error)
ok('_token_id helper is not callable by clients', !!(await as('anon', null, `select fanday._token_id('${T1}')`)).error)

ok('token 1 sets follows (unknown team skipped)', !(await as('anon', null, `select fanday.device_follows_set('${T1}', array['nfl-kc-x','nope'])`)).error
  && (await as('anon', null, `select fanday.device_follows_list('${T1}') l`)).rows[0].l.join() === 'nfl-kc-x')
await as('anon', null, `select fanday.device_follows_set('${T2}', array['nfl-den-x'])`)
ok('token 2 cannot see or change token 1 rows', (await as('anon', null, `select fanday.device_follows_list('${T2}') l`)).rows[0].l.join() === 'nfl-den-x'
  && (await db.query(`select count(*)::int c from fanday.follows where token_id='${id1}'`)).rows[0].c === 1)
ok('set replaces the list (removal works)', !(await as('anon', null, `select fanday.device_follows_set('${T1}', array['nfl-den-x'])`)).error && (await as('anon', null, `select fanday.device_follows_list('${T1}') l`)).rows[0].l.join() === 'nfl-den-x')
ok('signed-in A cannot see device-owned rows through the table', await n('authenticated', A, `select 1 from fanday.follows where token_id is not null`) === 0)
ok('wrong token rejected (unknown, too short, null)', !!(await as('anon', null, `select fanday.device_follows_list('${T3}')`)).error && !!(await as('anon', null, `select fanday.device_follows_list('short')`)).error
  && !!(await as('anon', null, `select fanday.device_follows_set(null, array['x'])`)).error)
ok('too many teams refused', !!(await as('anon', null, `select fanday.device_follows_set('${T1}', (select array_agg(id) from fanday.teams))`)).error)

ok('calendar: token 1 registers a device and its events (unknown game skipped)', !(await as('anon', null, `select fanday.device_calendar_upsert('${T1}','${DEV1}','ios','cal-1','[{"game_id":"${G1}","event_identifier":"E1","synced_rev":5},{"game_id":"eeeeeeee-0000-0000-0000-000000000009","event_identifier":"E2"}]'::jsonb)`)).error
  && (await db.query(`select count(*)::int c from fanday.device_events where device_id='${DEV1}'`)).rows[0].c === 1)
ok('calendar: token 2 cannot take over or write token 1 device', !!(await as('anon', null, `select fanday.device_calendar_upsert('${T2}','${DEV1}','android','x','[]'::jsonb)`)).error
)
ok('calendar: a bad platform is refused', !!(await as('anon', null, `select fanday.device_calendar_upsert('${T1}','${DEV2}','blackberry','x','[]'::jsonb)`)).error)
ok('calendar: token 2 forget does not remove token 1 device', !(await as('anon', null, `select fanday.device_calendar_forget('${T2}','${DEV1}')`)).error
  && (await db.query(`select count(*)::int c from fanday.devices where id='${DEV1}'`)).rows[0].c === 1)
await as('anon', null, `select fanday.device_log_event('${T1}','open')`)
ok('usage event logged against the device only', (await db.query(`select count(*)::int c from fanday.usage_events where token_id='${id1}' and user_id is null`)).rows[0].c === 1)

// ---- claim: signed-in user takes the device
await as('anon', null, `select fanday.device_follows_set('${T1}', array['nfl-den-x','epl-arsenal'])`) // A already follows nfl-den-x; epl-arsenal is new to A
ok('claim: anon role cannot call it', !!(await as('anon', null, `select fanday.claim_device('${T1}')`)).error)
ok('claim: a mismatched (unknown) token fails and moves nothing', !!(await as('authenticated', A, `select fanday.claim_device('${T3}')`)).error && (await db.query(`select count(*)::int c from fanday.follows where user_id='${A}'`)).rows[0].c === 2)
const cl = await as('authenticated', A, `select fanday.claim_device('${T1}') r`)
ok('claim: A takes the device follows (merged with own), the calendar device, its events and usage', cl.rows?.[0]?.r?.moved_follows === 1 && cl.rows[0].r.moved_devices === 1
  && (await db.query(`select string_agg(team_id, ',' order by team_id) s from fanday.follows where user_id='${A}'`)).rows[0].s === 'epl-arsenal,nfl-den-x,nfl-kc-x'
  && (await db.query(`select user_id::text u, token_id::text t from fanday.devices where id='${DEV1}'`)).rows[0].u === A
  && (await db.query(`select count(*)::int c from fanday.device_events where device_id='${DEV1}'`)).rows[0].c === 1
  && (await db.query(`select count(*)::int c from fanday.usage_events where user_id='${A}' and name='open'`)).rows[0].c === 2
  && (await db.query(`select count(*)::int c from fanday.follows where token_id='${id1}'`)).rows[0].c === 0, JSON.stringify(cl))
ok('claim: the token is dead afterwards (reads, writes, second claim by A, claim by B)', !!(await as('anon', null, `select fanday.device_follows_list('${T1}')`)).error
  && !!(await as('authenticated', A, `select fanday.claim_device('${T1}')`)).error && !!(await as('authenticated', B, `select fanday.claim_device('${T1}')`)).error)
ok('claim: B could not steal anything via the used token', (await db.query(`select count(*)::int c from fanday.follows where user_id='${B}'`)).rows[0].c === 1)
const rec = (await db.query(`select claimed_by::text cb, claimed_at is not null ca from fanday.device_tokens where id='${id1}'`)).rows[0]
ok('claim: recorded who claimed and when', rec.cb === A && rec.ca)
ok('claim: a revoked token cannot be claimed', await (async () => { await reg(T4); await as('anon', null, `select fanday.device_delete('${T4}')`); return !!(await as('authenticated', C, `select fanday.claim_device('${T4}')`)).error })())
await reg(T3)
ok('claim: refused when two users race the same token (second sees it used)', await (async () => {
  await as('anon', null, `select fanday.device_follows_set('${T3}', array['nfl-kc-x'])`)
  const [r1, r2] = await Promise.all([as('authenticated', C, `select fanday.claim_device('${T3}') r`), as('authenticated', D, `select fanday.claim_device('${T3}') r`)])
  return [r1, r2].filter((r) => r.error).length === 1 && [r1, r2].filter((r) => r.rows).length === 1
})())

// ---- device delete (signed-out)
await as('anon', null, `select fanday.device_calendar_upsert('${T2}','${DEV2}','android','c2','[{"game_id":"${G1}","event_identifier":"E3"}]'::jsonb)`)
await as('anon', null, `select fanday.device_log_event('${T2}','open')`)
const dd = await as('anon', null, `select fanday.device_delete('${T2}') r`)
ok('device delete removes every row of the device and reports counts', dd.rows?.[0]?.r?.follows === 1 && dd.rows[0].r.devices === 1
  && (await db.query(`select (select count(*) from fanday.follows where token_id='${id2}')::int + (select count(*) from fanday.devices where token_id='${id2}')::int + (select count(*) from fanday.usage_events where token_id='${id2}')::int + (select count(*) from fanday.device_events where device_id='${DEV2}')::int c`)).rows[0].c === 0)
ok('device delete revokes the token (reuse fails) and touches nobody else', !!(await as('anon', null, `select fanday.device_follows_list('${T2}')`)).error && !!(await as('anon', null, `select fanday.device_delete('${T2}')`)).error
  && (await db.query(`select count(*)::int c from fanday.follows where user_id='${B}'`)).rows[0].c === 1)

// ---- rate limits and salts
ok('rl: salt is stable within a day and server-only', (await svc('select fanday.rl_salt() s')).rows[0].s === (await svc('select fanday.rl_salt() s')).rows[0].s && !!(await as('anon', null, 'select fanday.rl_salt()')).error)
const hits = []; for (let i = 0; i < 5; i++) hits.push((await svc(`select fanday.rl_hit('t','k',date_trunc('hour', now()), 3) ok`)).rows[0].ok)
ok('rl: allows up to the limit, then refuses', hits.join() === 'true,true,true,false,false' && !!(await as('anon', null, `select fanday.rl_hit('t','k',now(),3)`)).error)
ok('rl: stores counters only (no address or email columns)', (await db.query(`select string_agg(column_name,',' order by column_name) c from information_schema.columns where table_schema='fanday' and table_name in ('rate_counters','rl_salts')`)).rows[0].c === 'day,key,n,salt,scope,window_start')

// ---- link counting
await svc(`select fanday.record_link_click('${G1}','watch')`); await svc(`select fanday.record_link_click('${G1}','watch')`)
ok('link_clicks: one counter row, server-only, no person columns', (await db.query(`select clicks from fanday.link_clicks`)).rows[0].clicks === 2 && !!(await as('authenticated', A, `select fanday.record_link_click('${G1}','watch')`)).error
  && String(await n('authenticated', A, 'select 1 from fanday.link_clicks')).startsWith('ERR:') && (await db.query(`select string_agg(column_name,',' order by column_name) c from information_schema.columns where table_schema='fanday' and table_name='link_clicks'`)).rows[0].c === 'clicks,day,game_id,slot')

// ---- device id ownership is one atomic statement (no check-then-write gap)
const RACE = 'dddddddd-0000-0000-0000-0000000000ff'
// two fresh tokens (T1 was claimed above and T2 revoked)
const R1 = '1'.repeat(64), R2 = '2'.repeat(64); await reg(R1); await reg(R2)
const race = await Promise.all([R1, R2].map((t) => as('anon', null, `select fanday.device_calendar_upsert('${t}','${RACE}','ios','c','[]'::jsonb)`)))
ok('race: two tokens upserting the same new device id -> exactly one owns it, the other is refused', race.filter((r) => r.error).length === 1 && race.filter((r) => r.rows).length === 1
  && (await db.query(`select count(*)::int c from fanday.devices where id='${RACE}'`)).rows[0].c === 1)
const winner = (await db.query(`select token_id::text t from fanday.devices where id='${RACE}'`)).rows[0].t
ok('race: the loser changed nothing (platform/calendar untouched), the winner can still update', (await db.query(`select calendar_id c from fanday.devices where id='${RACE}'`)).rows[0].c === 'c'
  && !(await as('anon', null, `select fanday.device_calendar_upsert('${winner === (await db.query(`select id::text i from fanday.device_tokens where token_hash = sha256(convert_to('${R1}','UTF8'))`)).rows[0].i ? R1 : R2}','${RACE}','ios','c2','[]'::jsonb)`)).error
  && (await db.query(`select calendar_id c from fanday.devices where id='${RACE}'`)).rows[0].c === 'c2')
await db.exec(`insert into fanday.devices (id, user_id, platform) values ('dddddddd-0000-0000-0000-0000000000fe','${B}','ios')`)
ok('a user-owned device id is refused to a token and left untouched', !!(await as('anon', null, `select fanday.device_calendar_upsert('${R1}','dddddddd-0000-0000-0000-0000000000fe','android','x','[]'::jsonb)`)).error
  && (await db.query(`select platform p, calendar_id c from fanday.devices where id='dddddddd-0000-0000-0000-0000000000fe'`)).rows[0].p === 'ios')

// ---- usage log is capped per device per day
const LT = '9'.repeat(64); const ltId = await reg(LT)
for (let i = 0; i < 205; i++) await as('anon', null, `select fanday.device_log_event('${LT}','open')`)
ok('device_log_event: 200 per device per UTC day, the rest dropped silently (no error)', (await db.query(`select count(*)::int c from fanday.usage_events where token_id='${ltId}'`)).rows[0].c === 200
  && !(await as('anon', null, `select fanday.device_log_event('${LT}','open')`)).error)

// ---- alert dedupe
ok('alert_once: true once per kind and window, then false; service_role only', (await svc(`select fanday.alert_once('k', date_trunc('hour', now())) a`)).rows[0].a === true
  && (await svc(`select fanday.alert_once('k', date_trunc('hour', now())) a`)).rows[0].a === false
  && (await svc(`select fanday.alert_once('k', date_trunc('hour', now()) + interval '1 hour') a`)).rows[0].a === true
  && !!(await as('anon', null, `select fanday.alert_once('k', now())`)).error && String(await n('authenticated', A, 'select 1 from fanday.alert_log')).startsWith('ERR:'))

// ---- Apple identity: which one Fanday added
const mkA = async (n, provs, age = '0 minutes') => {
  const id = `${n}${n}${n}${n}${n}${n}${n}${n}-0000-4000-8000-0000000000a${n}`
  await db.exec(`insert into auth.users (id, email) values ('${id}','ap${n}@x.com'); ${provs.map(([p, a]) => `insert into auth.identities (user_id, provider, created_at) values ('${id}','${p}', now() - interval '${a ?? age}');`).join('')}`)
  return id
}
const apple = async (id) => (await db.query(`select apple_added_by_fanday a from fanday.user_origin where user_id='${id}'`)).rows[0]?.a ?? null
const [X1, X2, X3, X4] = [await mkA(1, [['apple']]), await mkA(2, [['google'], ['apple', '2 days']]), await mkA(3, [['google', '2 days']]), await mkA(4, [['google', '2 days']])]
for (const x of [X1, X2, X3, X4]) await as('authenticated', x, 'select fanday.ensure_profile()')
ok('apple origin: first use via Fanday Apple sign-in (fresh identity) -> apple_added_by_fanday = true', (await apple(X1)) === true)
ok('apple origin: an Apple identity that already existed (older) -> false', (await apple(X2)) === false)
ok('apple origin: no Apple identity -> false; a later fresh Apple identity (Fanday sign-in) flips it to true; older ones never do', (await apple(X3)) === false
  && await (async () => { await db.exec(`insert into auth.identities (user_id, provider) values ('${X3}','apple')`); await as('authenticated', X3, 'select fanday.ensure_profile()'); return (await apple(X3)) === true })()
  && await (async () => { await db.exec(`insert into auth.identities (user_id, provider, created_at) values ('${X4}','apple', now() - interval '3 days')`); await as('authenticated', X4, 'select fanday.ensure_profile()'); return (await apple(X4)) === false })())
ok('apple origin: auth_user_deletable reports it', (await svc(`select fanday.auth_user_deletable('${X3}') r`)).rows[0].r.apple_added_by_fanday === true)
await db.exec(`delete from fanday.user_origin where user_id in ('${X1}','${X2}','${X3}','${X4}'); delete from fanday.profiles where user_id in ('${X1}','${X2}','${X3}','${X4}')`)

// ---- cleanup (service_role only, not scheduled)
await reg('e'.repeat(64)); await reg('f'.repeat(64))
await db.exec(`update fanday.device_tokens set last_used_at = now() - interval '25 months' where token_hash = sha256(convert_to('${'e'.repeat(64)}','UTF8'));
  insert into fanday.follows (token_id, team_id) select id, 'nfl-kc-x' from fanday.device_tokens where token_hash = sha256(convert_to('${'e'.repeat(64)}','UTF8'));
  update fanday.device_tokens set revoked_at = now() - interval '31 days' where id = '${id2}'`)
const cu = (await svc('select fanday.cleanup_unused_device_tokens() n')).rows[0].n
ok('cleanup: removes tokens unused 24+ months (rows cascade) and revoked/claimed 30+ days; keeps the rest', cu >= 2
  && (await db.query(`select count(*)::int c from fanday.device_tokens where token_hash = sha256(convert_to('${'e'.repeat(64)}','UTF8'))`)).rows[0].c === 0
  && (await db.query(`select count(*)::int c from fanday.device_tokens where token_hash = sha256(convert_to('${'f'.repeat(64)}','UTF8'))`)).rows[0].c === 1
  && (await db.query(`select count(*)::int c from fanday.follows where token_id is not null and team_id='nfl-kc-x' and token_id not in (select id from fanday.device_tokens)`)).rows[0].c === 0)
ok('cleanup is not callable by clients; no anonymous-user cleanup function exists', !!(await as('authenticated', A, 'select fanday.cleanup_unused_device_tokens()')).error
  && (await db.query(`select count(*)::int c from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='fanday' and p.proname in ('cleanup_merged_anonymous_users','create_merge_claim','claim_anonymous_follows')`)).rows[0].c === 0)

// ---- orphans (no FK to auth.users)
await db.exec(`insert into auth.users (id, email) values ('55555555-5555-5555-5555-555555555555','z@x.com'); insert into fanday.follows (user_id, team_id) values ('55555555-5555-5555-5555-555555555555','nfl-kc-x');
  delete from auth.users where id='55555555-5555-5555-5555-555555555555'`)
ok('rows of an auth user deleted elsewhere are swept by purge_orphaned_user_rows (and live users untouched)', (await svc('select fanday.purge_orphaned_user_rows() n')).rows[0].n === 1
  && (await db.query(`select count(*)::int c from fanday.follows where user_id='${A}'`)).rows[0].c === 3)

process.exit(ok.fails() ? 1 : (console.log('\nall migration checks passed'), 0))
