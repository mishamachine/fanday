#!/usr/bin/env bash
# Snapshot of EVERYTHING outside schema `fanday` in the local dry-run container: schema DDL with ACLs (pg_dump -s -N fanday), role attributes (no passwords),
# role settings, default privileges, event triggers, extensions, schema ACLs, row counts. Usage: snapshot.sh <container> <outfile>
set -euo pipefail
C="${1:?container}"; OUT="${2:?outfile}"
P="docker exec -i $C psql -U supabase_admin -d postgres -AtX"
{
  echo "## pg_dump schema-only, all schemas except fanday (includes grants, policies, triggers, event triggers, extensions, default privileges)"
  docker exec "$C" pg_dump -U supabase_admin -d postgres --schema-only -N fanday --no-comments | grep -v -E '^(-- Dumped|\\restrict|\\unrestrict)'
  echo "## roles (attributes only)"
  $P -c "select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls, rolconnlimit from pg_roles order by 1"
  echo "## role/db settings"
  $P -c "select coalesce(r.rolname,'(all)'), s.setconfig::text from pg_db_role_setting s left join pg_roles r on r.oid=s.setrole order by 1,2"
  echo "## role memberships"
  $P -c "select m.roleid::regrole, m.member::regrole from pg_auth_members m order by 1,2"
  echo "## schema ACLs and owners"
  $P -c "select nspname, nspowner::regrole, coalesce(nspacl::text,'') from pg_namespace where nspname<>'fanday' and nspname !~ '^pg_(temp|toast)' order by 1"
  echo "## default ACLs"
  $P -c "select defaclrole::regrole, coalesce(defaclnamespace::regnamespace::text,'(global)'), defaclobjtype::text, defaclacl::text from pg_default_acl order by 1,2,3"
  echo "## event triggers"
  $P -c "select evtname, evtevent, evtfoid::regproc, evtenabled from pg_event_trigger order by 1"
  echo "## extensions"
  $P -c "select extname, extversion, extnamespace::regnamespace from pg_extension order by 1"
  echo "## ACL of every relation, function, type outside fanday"
  $P -c "select 'rel', c.oid::regclass::text, c.relkind::text, pg_get_userbyid(c.relowner), coalesce(c.relacl::text,'') from pg_class c where relnamespace::regnamespace::text not in ('fanday','pg_catalog','information_schema','pg_toast') order by 2"
  $P -c "select 'fn', p.oid::regprocedure::text, pg_get_userbyid(p.proowner), coalesce(p.proacl::text,'') from pg_proc p where pronamespace::regnamespace::text not in ('fanday','pg_catalog','information_schema') order by 2"
  echo "## row counts (exact) of tables outside fanday"
  $P -c "select c.oid::regclass::text, (xpath('/row/n/text()', query_to_xml(format('select count(*) n from %s', c.oid::regclass), false, true, '')))[1]::text from pg_class c where relkind='r' and relnamespace::regnamespace::text not in ('fanday','pg_catalog','information_schema','pg_toast') order by 1"
  echo "## RLS flags"
  $P -c "select c.oid::regclass::text, relrowsecurity, relforcerowsecurity from pg_class c where relkind in ('r','p') and relnamespace::regnamespace::text not in ('fanday','pg_catalog','information_schema','pg_toast') order by 1"
} > "$OUT"
sha256sum "$OUT" 2>/dev/null || shasum -a 256 "$OUT"
wc -l "$OUT"
