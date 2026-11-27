// Account deletion on a shared project, both paths, against real Postgres (pglite) with other apps' rows seeded.
// Runs the real decision code (supabase/functions/fanday-delete-account/delete.ts) with the database calls wired to the stand-in.
import { makeStandIn, asFactory, read, U, ok } from './standin.mjs'
import { deleteAccount } from '../../supabase/functions/fanday-delete-account/delete.ts'

const db = await makeStandIn()
const as = asFactory(db)
for (const f of ['migrations/fanday_0001_init.sql', 'migrations/fanday_0002_ingest.sql', 'seed.sql', 'seed_teams.sql']) await db.exec(read(f))
const mk = (n) => `${n}${n}${n}${n}${n}${n}${n}${n}-0000-4000-8000-00000000000${n}`
const [P1, P2, P3, P4, P5, P6, P7] = ['1', '2', '3', '4', '5', '6', '7'].map(mk)
const user = async (id, created, apple = false, appleByFanday = apple) => {
  await db.exec(`insert into auth.users (id, email) values ('${id}','${id.slice(0, 2)}@x.com');
    ${created ? `insert into fanday.user_origin (user_id, created_by_fanday, apple_added_by_fanday) values ('${id}', true, ${appleByFanday});` : `insert into fanday.user_origin (user_id, created_by_fanday, apple_added_by_fanday) values ('${id}', false, ${appleByFanday});`}
    insert into auth.identities (id, user_id, provider) values (gen_random_uuid(), '${id}', 'email'), ${apple ? `('${id.replace(/^../, 'ab')}','${id}','apple')` : `(gen_random_uuid(),'${id}','email2')`};
    insert into auth.sessions (user_id) values ('${id}');
    insert into fanday.profiles (user_id, email) values ('${id}','x'); insert into fanday.follows (user_id, team_id) values ('${id}','epl-arsenal');
    insert into fanday.devices (id, user_id, platform) values (gen_random_uuid(), '${id}', 'ios'); insert into fanday.usage_events (user_id, name) values ('${id}','open')`)
}
for (const [id, created, apple, byFanday] of [[P1, true, false], [P2, true, true], [P3, false, false], [P4, true, false], [P5, true, true, false], [P6, true, false], [P7, true, false]]) await user(id, created, apple, byFanday)
await db.exec(`insert into public.app_a_progress (user_id, lesson_id) values ('${P2}',1);            -- a row in another app
  create table public.app_c_events (id serial primary key, user_id text, kind text);             -- a text user_id in some other app
  create table public.app_d_frames (id serial primary key, user_id uuid, frame jsonb);           -- a uuid user_id in some other app
  insert into public.app_c_events (user_id, kind) values ('${P4}','move'); insert into public.app_d_frames (user_id, frame) values ('${P5}','{}');
  insert into public.app_b_events (game_id, kind) values ('g1','move');                              -- another app with no user_id column at all
  insert into public.app_a_settings (user_id, settings) values ('${P7}','{}')`)

const unlinked = []
const deps = (opts = {}) => ({
  rpc: async (fn, args) => {
    const arg = Object.values(args)[0]
    const r = await as('service_role', null, `select fanday.${fn}('${arg}') r`)
    return r.error ? { data: null, error: { message: r.error } } : { data: r.rows[0].r, error: null }
  },
  deleteAuthUser: async (id) => { if (opts.failDelete) return 'boom'; await db.exec(`delete from auth.users where id='${id}'`); return null },
  unlinkIdentity: async (identityId) => { unlinked.push(identityId); await db.exec(`delete from auth.identities where id='${identityId}'`); return true },
})
const apple = async (id) => (await db.query(`select id from auth.identities where user_id='${id}' and provider='apple'`)).rows[0]?.id ?? null
const count = async (t, id) => (await db.query(`select count(*)::int c from ${t} where user_id='${id}'`)).rows[0].c
const fanRows = async (id) => (await count('fanday.profiles', id)) + (await count('fanday.follows', id)) + (await count('fanday.devices', id)) + (await count('fanday.usage_events', id))
const exists = async (id) => (await db.query(`select count(*)::int c from auth.users where id='${id}'`)).rows[0].c === 1

// The dynamic check itself
const dec = async (id) => (await as('service_role', null, `select fanday.auth_user_deletable('${id}') r`)).rows[0].r
ok('check: P1 created by Fanday, owns nothing elsewhere -> deletable (auth.sessions/identities do not count)', (await dec(P1)).deletable === true)
ok('check: P2 has a row in another app -> not deletable', (await dec(P2)).foreign_rows === true && (await dec(P2)).deletable === false)
ok('check: P3 not created by Fanday -> not deletable', (await dec(P3)).fanday_created === false && (await dec(P3)).deletable === false)
ok('check: P4 text user_id row in another app table is caught', (await dec(P4)).foreign_rows === true)
ok('check: P5 uuid user_id row in another app table is caught', (await dec(P5)).foreign_rows === true)
ok('check: a brand-new table with a user_id column is caught (catalog-driven, not a fixed list)', await (async () => {
  await db.exec(`create table public.app_e_things (id serial primary key, user_id uuid); insert into public.app_e_things (user_id) values ('${P6}')`)
  return (await dec(P6)).foreign_rows === true
})())
// H2: rows keyed by something other than a column named user_id, Storage, and "0 rows visible" under row level security
const mkq = (n) => `cccccc0${n}-0000-4000-8000-00000000000${n}`
const [Q0, Q1, Q2, Q3, Q4, Q5] = ['0', '1', '2', '3', '4', '5'].map(mkq)
await db.exec(`insert into auth.users (id, email) select id::uuid, 'q' || n || '@x.com' from (values ('${Q0}', 0), ('${Q1}', 1), ('${Q2}', 2), ('${Q3}', 3), ('${Q4}', 4), ('${Q5}', 5)) v(id, n);
  create schema appx;
  create table appx.items (id serial primary key, owner_id uuid references auth.users (id));            -- another schema, FK column named owner_id
  create table appx.people (id uuid primary key references auth.users (id));                            -- keyed by id
  create table appx.notes (id serial primary key, profile_id uuid references auth.users (id) on delete cascade);
  create schema storage;
  create table storage.objects (id serial primary key, bucket_id text, owner uuid, owner_id text);      -- Storage keeps the owner as plain columns
  insert into appx.items (owner_id) values ('${Q1}'); insert into appx.people (id) values ('${Q2}'); insert into appx.notes (profile_id) values ('${Q3}');
  insert into storage.objects (bucket_id, owner_id) values ('b', '${Q4}'); insert into storage.objects (bucket_id, owner) values ('b', '${Q5}')`)
const hasRows = async (id) => { const x = await as('service_role', null, `select fanday.user_has_foreign_rows('${id}') r`); if (x.error) throw new Error(x.error); return x.rows[0].r }
ok('H2: a user with no rows anywhere is clean even with those tables present', (await hasRows(Q0)) === false)
ok('H2: a foreign key column named owner_id / id / profile_id in another schema is caught', (await hasRows(Q1)) === true && (await hasRows(Q2)) === true && (await hasRows(Q3)) === true)
ok('H2: storage.objects owner_id (text) and owner (uuid) are caught', (await hasRows(Q4)) === true && (await hasRows(Q5)) === true)
ok('H2: fails closed when this function would not see every row (no BYPASSRLS, not the table owner, RLS on)', await (async () => {
  const orig = (await db.query(`select pg_get_userbyid(proowner) o from pg_proc where proname = 'user_has_foreign_rows'`)).rows[0].o
  await db.exec(`create role fd_low nologin; grant create on schema fanday to fd_low; grant usage on schema public, appx, storage, auth to fd_low;
    grant select on all tables in schema public to fd_low; grant select on all tables in schema appx to fd_low; grant select on all tables in schema storage to fd_low;
    alter function fanday.user_has_foreign_rows(uuid) owner to fd_low`)
  const clean = await hasRows(Q0)            // would read "no rows" if RLS filtered everything and the function trusted it
  const sees = await as('service_role', null, `select fanday.user_has_foreign_rows('${Q1}') r`)
  await db.exec(`alter function fanday.user_has_foreign_rows(uuid) owner to ${orig}; revoke create on schema fanday from fd_low; reset role`)
  return clean === true && sees.rows?.[0]?.r === true && (await hasRows(Q0)) === false
})())
ok('check: no origin row at all -> treated as not created by Fanday', await (async () => { await db.exec(`insert into auth.users (id, email) values ('99999999-0000-4000-8000-000000000001','n@x.com')`); return (await dec('99999999-0000-4000-8000-000000000001')).deletable === false })())
ok('check: unknown user -> not deletable; user_has_foreign_rows is service_role only', (await dec('99999999-9999-9999-9999-999999999999')).deletable === false
  && !!(await as('authenticated', P1, `select fanday.user_has_foreign_rows('${P1}')`)).error && !!(await as('anon', null, `select fanday.auth_user_deletable('${P1}')`)).error)

// Path 1: Fanday created the user and nothing else uses it -> everything goes
let r = await deleteAccount(P1, deps(), { appleIdentityId: null })
ok('path 1 (delete): auth user and all Fanday rows are gone', r.ok && r.authUserDeleted === true && !(await exists(P1)) && (await fanRows(P1)) === 0, JSON.stringify(r))

// Path 2: shared user (data in another app) -> Fanday rows go, auth user stays, its Apple identity is unlinked, the other app's data stays
const appleId = await apple(P2)
r = await deleteAccount(P2, deps(), { appleIdentityId: appleId })
ok('path 2 (unlink): Fanday rows deleted, auth user KEPT, other-app row intact', r.ok && r.authUserDeleted === false && (await exists(P2)) && (await fanRows(P2)) === 0 && (await count('public.app_a_progress', P2)) === 1, JSON.stringify(r))
ok('path 2: the Apple identity Fanday added is unlinked; the other identity stays', r.appleUnlinked === true && unlinked.includes(appleId) && (await apple(P2)) === null
  && (await db.query(`select count(*)::int c from auth.identities where user_id='${P2}'`)).rows[0].c === 1)

r = await deleteAccount(P3, deps(), { appleIdentityId: null })
ok('path 2: a user Fanday did not create is never deleted (no foreign rows needed)', r.ok && r.authUserDeleted === false && (await exists(P3)) && (await fanRows(P3)) === 0)
r = await deleteAccount(P4, deps(), { appleIdentityId: null })
ok('path 2: text-id user kept, other-app row intact', r.ok && r.authUserDeleted === false && (await exists(P4)) && (await count('public.app_c_events', P4)) === 1 && (await fanRows(P4)) === 0)
const p5Apple = await apple(P5)
r = await deleteAccount(P5, deps(), { appleIdentityId: p5Apple })
ok('path 2: uuid-id user kept; its Apple identity was NOT added by Fanday so it is NOT unlinked; row intact', r.ok && !r.authUserDeleted && (await exists(P5)) && r.appleUnlinked === false && (await apple(P5)) !== null && (await count('public.app_d_frames', P5)) === 1)
r = await deleteAccount(P6, deps(), { appleIdentityId: null })
ok('path 2: user with a row in a table added later is kept', r.ok && !r.authUserDeleted && (await exists(P6)))
r = await deleteAccount(P7, deps(), { appleIdentityId: null })
ok('path 2: settings-only user of another app kept (user_id is the primary key there)', r.ok && !r.authUserDeleted && (await exists(P7)) && (await count('public.app_a_settings', P7)) === 1)

// Failure handling
await user('88888888-0000-4000-8000-000000000008', true)
const P8 = '88888888-0000-4000-8000-000000000008'
r = await deleteAccount(P8, deps({ failDelete: true }), { appleIdentityId: null })
ok('a failed auth-user delete is reported (caller returns 500 and the client retries); the retry then succeeds', !r.ok && r.stage === 'auth' && (await exists(P8))
  && (await deleteAccount(P8, deps(), { appleIdentityId: null })).authUserDeleted === true && !(await exists(P8)))
ok('origin row is removed with the account (deleted user) and with an unlink', (await db.query(`select count(*)::int c from fanday.user_origin where user_id in ('${P1}','${P2}','${P8}')`)).rows[0].c === 0)
ok('nothing of other users was touched by any delete', (await count('public.app_a_progress', P2)) === 1 && (await db.query(`select count(*)::int c from auth.users`)).rows[0].c === 7 + 6)  // 6 = the H2 users

// Re-check right before deleting the auth user: another app writes a row between the first look and the delete
await user('77777777-0000-4000-8000-000000000009', true)
const P9 = '77777777-0000-4000-8000-000000000009'
const racing = deps(); const baseRpc = racing.rpc
racing.rpc = async (fn, args) => { const out = await baseRpc(fn, args); if (fn === 'delete_user_data') await db.exec(`insert into public.app_a_saved (user_id, lesson_id) values ('${P9}', 1)`); return out }
r = await deleteAccount(P9, racing, { appleIdentityId: null })
ok('re-check: a row that appeared after the first check stops the auth-user delete (kept, Fanday rows gone)', r.ok && r.authUserDeleted === false && (await exists(P9)) && (await count('public.app_a_saved', P9)) === 1 && (await fanRows(P9)) === 0, JSON.stringify(r))

// Error stages (what the caller tells the user)
await user('66666666-0000-4000-8000-000000000008', true)
const PA = '66666666-0000-4000-8000-000000000008'
const failRows = deps(); const fr = failRows.rpc; failRows.rpc = async (fn, a) => fn === 'delete_user_data' ? { data: null, error: { message: 'db down' } } : fr(fn, a)
r = await deleteAccount(PA, failRows, { appleIdentityId: null })
ok('stage "rows": reported when the Fanday rows could not be deleted (nothing deleted)', !r.ok && r.stage === 'rows' && (await fanRows(PA)) > 0)
r = await deleteAccount(PA, deps({ failDelete: true }), { appleIdentityId: null })
ok('stage "auth": reported when only the account delete failed (Fanday rows already gone)', !r.ok && r.stage === 'auth' && (await fanRows(PA)) === 0 && (await exists(PA)))
await deleteAccount(PA, deps(), { appleIdentityId: null })

// Signed-in claim token rows of a deleted user go too
await db.exec(`insert into fanday.device_tokens (token_hash, claimed_by, claimed_at) values ('\\x0102', '${P3}', now())`)
await deleteAccount(P3, deps(), { appleIdentityId: null })
ok('device tokens the user claimed are erased with the account', (await db.query(`select count(*)::int c from fanday.device_tokens where claimed_by='${P3}'`)).rows[0].c === 0)

process.exit(ok.fails() ? 1 : (console.log('\nall delete-path checks passed'), 0))
