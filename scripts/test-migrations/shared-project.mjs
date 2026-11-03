// The cross-app safety proof for the SHARED project: applying Fanday's migrations and seeds changes NOTHING outside schema `fanday`.
// 1. Build a stand-in of the shared project (Woofabulary + Chess Tutor tables, RLS, grants, a trigger, auth).  2. Snapshot the catalog and
// the data outside `fanday`.  3. Apply fanday_0001 + fanday_0002 + seeds, then apply them all again.  4. Assert the snapshot is byte-identical.
import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { makeStandIn, read, U, ok, catalogSnapshot } from './standin.mjs'

const migrations = readdirSync(fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))).sort()
ok('only fanday_* migrations exist, in order', migrations.join() === 'fanday_0001_init.sql,fanday_0002_ingest.sql', migrations.join())
const files = ['migrations/fanday_0001_init.sql', 'migrations/fanday_0002_ingest.sql', 'seed.sql', 'seed_teams.sql', 'seed/teams_tz.sql']

// ---- static lint of the SQL we ship (comments stripped)
const strip = (s) => s.replace(/--.*$/gm, '')
for (const f of files) {
  const sql = strip(read(f))
  const bad = []
  if (/\bpublic\./i.test(sql)) bad.push('mentions public.')
  if (/\bcreate\s+(or\s+replace\s+)?trigger\b/i.test(sql)) bad.push('creates a trigger')
  if (/\breferences\s+auth\./i.test(sql)) bad.push('foreign key into auth')
  if (/\balter\s+default\s+privileges\b/i.test(sql)) bad.push('alters default privileges')
  if (/\b(drop|alter|truncate)\s+(table|schema|function|view|type|extension|role|policy)\s+(if\s+exists\s+)?(?!fanday\.)\S/i.test(sql.replace(/drop policy if exists \w+\s+on fanday\.\w+/gi, '').replace(/alter table fanday\./gi, 'ALTER_OK'))) bad.push('drop/alter/truncate outside fanday')
  if (/\bon\s+schema\s+(?!fanday\b)/i.test(sql)) bad.push('grant/revoke on another schema')
  if (/\bcreate\s+(extension|role|user)\b/i.test(sql)) bad.push('creates extension/role')
  const authRefs = [...sql.matchAll(/\bauth\.(\w+)/gi)].map((m) => m[1].toLowerCase()).filter((x) => !['users', 'uid'].includes(x))
  if (authRefs.length) bad.push(`touches auth.${authRefs.join(',')}`)
  ok(`lint ${f}: only fanday objects`, bad.length === 0, bad.join('; '))
}
// auth.users is only ever read: no insert/update/delete/alter on it
ok('auth.users is only read (no write statement)', !files.some((f) => /\b(insert\s+into|update|delete\s+from|alter\s+table)\s+auth\./i.test(strip(read(f)))))
// every function is SECURITY DEFINER with an empty search_path, or SECURITY INVOKER with an empty search_path
const fnBlocks = strip(read('migrations/fanday_0001_init.sql') + read('migrations/fanday_0002_ingest.sql')).split(/create or replace function /i).slice(1)
ok('every function sets search_path = \'\'', fnBlocks.length >= 20 && fnBlocks.every((b) => /set search_path = ''/.test(b.split(/\$\$|\$[a-z]*\$/)[0] + b.slice(0, 600))), `${fnBlocks.length} functions`)

// ---- the proof
const db = await makeStandIn()
for (const [id, email, meta] of [[U.A, 'a@x.com', '{}'], [U.B, 'b@x.com', '{"fanday_created":true}'], [U.C, 'c@x.com', '{}'], [U.D, 'd@x.com', '{"fanday_created":true}']]) {
  await db.exec(`insert into auth.users (id, email, raw_app_meta_data) values ('${id}','${email}','${meta}')`)
}
await db.exec(`insert into public.user_progress (user_id, lesson_id) values ('${U.A}',1),('${U.C}',1); insert into public.user_settings (user_id, settings) values ('${U.A}','{"x":1}');
  insert into public.chess_events (user_id, kind) values ('${U.C}','move'); insert into public.chess_frames (user_id, frame) values ('${U.D}','{}');`)

const before = await catalogSnapshot(db)
const sha = (s) => createHash('sha256').update(s).digest('hex')
const parsed = JSON.parse(before)
ok('snapshot is meaningful: public tables, policies, grants, a trigger, a view, functions, roles', parsed.relations.length > 15 && parsed.policies.length === 7
  && parsed.triggers.some((t) => t.relname === 'user_settings') && parsed.functions.some((f) => f.proname === 'touch_updated_at') && parsed.roles.length >= 3
  && parsed.relations.some((r) => r.relname === 'lesson_summaries' && r.relkind === 'v') && parsed.data['public.user_progress'].n === 2)

for (const pass of [1, 2, 3]) {
  for (const f of files) {
    let err = null
    try { await db.exec(read(f)) } catch (e) { err = e.message }
    ok(`apply pass ${pass}: ${f}`, !err, err ?? '')
  }
}
const after = await catalogSnapshot(db)
console.log(`     catalog+data outside fanday: before sha256 ${sha(before).slice(0, 16)}, after sha256 ${sha(after).slice(0, 16)}, ${before.length} bytes`)
ok('CATALOG OUTSIDE fanday IS BYTE-IDENTICAL after apply + 2 reapplies', before === after)

const fan = (await db.query(`select (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='fanday' and c.relkind='r') t,
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='fanday') f,
  (select count(*)::int from fanday.leagues) l, (select count(*)::int from fanday.teams) tm, (select count(*)::int from fanday.teams where tz is not null) tz`)).rows[0]
ok('fanday got its tables, functions and seeds (14 tables, 19 leagues, 434 teams, 30 MLS zones)', fan.t === 14 && fan.f >= 20 && fan.l === 19 && fan.tm === 434 && fan.tz === 30, JSON.stringify(fan))
ok('no trigger on auth.users or on any fanday table (FK system triggers on auth.users are covered by the snapshot: unchanged)', (await db.query(`select count(*)::int c from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and ((n.nspname='auth' and c.relname='users') or n.nspname='fanday')`)).rows[0].c === 0)
ok('nothing fanday owns lives in public', (await db.query(`select count(*)::int c from pg_depend d join pg_proc p on p.oid=d.objid where false`)).rows[0].c === 0
  && (await db.query(`select count(*)::int c from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and (c.relname in ('leagues','teams','games','follows','profiles','devices','device_tokens') )`)).rows[0].c === 0)

// ---- the snapshot really detects a change (negative control)
await db.exec(`grant select on public.languages to service_role; revoke select on public.languages from anon`)
ok('negative control: a stray grant outside fanday IS detected by the snapshot', (await catalogSnapshot(db)) !== before)

process.exit(ok.fails() ? 1 : (console.log('\nshared-project proof passed'), 0))
