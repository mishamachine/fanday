// Account deletion on the shared project, both paths, against real Postgres (pglite) with Woofabulary and Chess Tutor rows seeded.
// Runs the real decision code (supabase/functions/fanday-delete-account/delete.ts) with the database calls wired to the stand-in.
import { makeStandIn, asFactory, read, U, ok } from './standin.mjs'
import { deleteAccount } from '../../supabase/functions/fanday-delete-account/delete.ts'

const db = await makeStandIn()
const as = asFactory(db)
for (const f of ['migrations/fanday_0001_init.sql', 'migrations/fanday_0002_ingest.sql', 'seed.sql', 'seed_teams.sql']) await db.exec(read(f))
const mk = (n) => `${n}${n}${n}${n}${n}${n}${n}${n}-0000-4000-8000-00000000000${n}`
const [P1, P2, P3, P4, P5, P6, P7] = ['1', '2', '3', '4', '5', '6', '7'].map(mk)
const user = async (id, created, apple = false) => {
  await db.exec(`insert into auth.users (id, email, raw_app_meta_data) values ('${id}','${id.slice(0, 2)}@x.com','${created ? '{"fanday_created":true}' : '{}'}');
    insert into auth.identities (id, user_id, provider) values (gen_random_uuid(), '${id}', 'email'), ${apple ? `('${id.replace(/^../, 'ab')}','${id}','apple')` : `(gen_random_uuid(),'${id}','email2')`};
    insert into auth.sessions (user_id) values ('${id}');
    insert into fanday.profiles (user_id, email) values ('${id}','x'); insert into fanday.follows (user_id, team_id) values ('${id}','epl-arsenal');
    insert into fanday.devices (id, user_id, platform) values (gen_random_uuid(), '${id}', 'ios'); insert into fanday.usage_events (user_id, name) values ('${id}','open')`)
}
for (const [id, created, apple] of [[P1, true, false], [P2, true, true], [P3, false, false], [P4, true, false], [P5, true, true], [P6, true, false], [P7, true, false]]) await user(id, created, apple)
await db.exec(`insert into public.user_progress (user_id, lesson_id) values ('${P2}',1);            -- Woofabulary row
  insert into public.chess_events (user_id, kind) values ('${P4}','move');                           -- Chess Tutor, text user_id
  insert into public.chess_frames (user_id, frame) values ('${P5}','{}');                            -- Chess Tutor, uuid user_id
  insert into public.user_settings (user_id, settings) values ('${P7}','{}')`)

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
ok('check: P2 has a Woofabulary row -> not deletable', (await dec(P2)).foreign_rows === true && (await dec(P2)).deletable === false)
ok('check: P3 not created by Fanday -> not deletable', (await dec(P3)).fanday_created === false && (await dec(P3)).deletable === false)
ok('check: P4 Chess Tutor text user_id row is caught', (await dec(P4)).foreign_rows === true)
ok('check: P5 Chess Tutor uuid user_id row is caught', (await dec(P5)).foreign_rows === true)
ok('check: a brand-new table with a user_id column is caught (catalog-driven, not a fixed list)', await (async () => {
  await db.exec(`create table public.newapp_things (id serial primary key, user_id uuid); insert into public.newapp_things (user_id) values ('${P6}')`)
  return (await dec(P6)).foreign_rows === true
})())
ok('check: unknown user -> not deletable; user_has_foreign_rows is service_role only', (await dec('99999999-9999-9999-9999-999999999999')).deletable === false
  && !!(await as('authenticated', P1, `select fanday.user_has_foreign_rows('${P1}')`)).error && !!(await as('anon', null, `select fanday.auth_user_deletable('${P1}')`)).error)

// Path 1: Fanday created the user and nothing else uses it -> everything goes
let r = await deleteAccount(P1, deps(), { appleIdentityId: null })
ok('path 1 (delete): auth user and all Fanday rows are gone', r.ok && r.authUserDeleted === true && !(await exists(P1)) && (await fanRows(P1)) === 0, JSON.stringify(r))

// Path 2: shared user (Woofabulary data) -> Fanday rows go, auth user, its Apple identity unlinked, Woofabulary data stay
const appleId = await apple(P2)
r = await deleteAccount(P2, deps(), { appleIdentityId: appleId })
ok('path 2 (unlink): Fanday rows deleted, auth user KEPT, Woofabulary row intact', r.ok && r.authUserDeleted === false && (await exists(P2)) && (await fanRows(P2)) === 0 && (await count('public.user_progress', P2)) === 1, JSON.stringify(r))
ok('path 2: the Apple identity Fanday added is unlinked; the other identity stays', r.appleUnlinked === true && unlinked.includes(appleId) && (await apple(P2)) === null
  && (await db.query(`select count(*)::int c from auth.identities where user_id='${P2}'`)).rows[0].c === 1)

r = await deleteAccount(P3, deps(), { appleIdentityId: null })
ok('path 2: a user Fanday did not create is never deleted (no foreign rows needed)', r.ok && r.authUserDeleted === false && (await exists(P3)) && (await fanRows(P3)) === 0)
r = await deleteAccount(P4, deps(), { appleIdentityId: null })
ok('path 2: Chess Tutor text-id user kept, chess row intact', r.ok && r.authUserDeleted === false && (await exists(P4)) && (await count('public.chess_events', P4)) === 1 && (await fanRows(P4)) === 0)
r = await deleteAccount(P5, deps(), { appleIdentityId: await apple(P5) })
ok('path 2: Chess Tutor uuid-id user kept, Apple unlinked, chess row intact', r.ok && !r.authUserDeleted && (await exists(P5)) && r.appleUnlinked === true && (await count('public.chess_frames', P5)) === 1)
r = await deleteAccount(P6, deps(), { appleIdentityId: null })
ok('path 2: user with a row in a table added later is kept', r.ok && !r.authUserDeleted && (await exists(P6)))
r = await deleteAccount(P7, deps(), { appleIdentityId: null })
ok('path 2: Woofabulary settings-only user kept (user_id is the primary key there)', r.ok && !r.authUserDeleted && (await exists(P7)) && (await count('public.user_settings', P7)) === 1)

// Failure handling
await user('88888888-0000-4000-8000-000000000008', true)
const P8 = '88888888-0000-4000-8000-000000000008'
r = await deleteAccount(P8, deps({ failDelete: true }), { appleIdentityId: null })
ok('a failed auth-user delete is reported (caller returns 500 and the client retries); the retry then succeeds', !r.ok && (await exists(P8))
  && (await deleteAccount(P8, deps(), { appleIdentityId: null })).authUserDeleted === true && !(await exists(P8)))
ok('nothing of other users was touched by any delete', (await count('public.user_progress', P2)) === 1 && (await db.query(`select count(*)::int c from auth.users`)).rows[0].c === 6)

// Signed-in claim token rows of a deleted user go too
await db.exec(`insert into fanday.device_tokens (token_hash, claimed_by, claimed_at) values ('\\x0102', '${P3}', now())`)
await deleteAccount(P3, deps(), { appleIdentityId: null })
ok('device tokens the user claimed are erased with the account', (await db.query(`select count(*)::int c from fanday.device_tokens where claimed_by='${P3}'`)).rows[0].c === 0)

process.exit(ok.fails() ? 1 : (console.log('\nall delete-path checks passed'), 0))
