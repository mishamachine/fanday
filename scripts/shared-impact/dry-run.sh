#!/usr/bin/env bash
# $0 local dry run of PR #6 against a schema-only COPY of the live shared project. Needs Docker and the image already on the machine; pulls nothing.
# Proves: (1) applying fanday_0001 + fanday_0002 + seeds changes nothing outside `fanday`; (2) rollback.sql restores the original and removes `fanday`.
set -euo pipefail
cd "$(dirname "$0")/../.."
IMG=public.ecr.aws/supabase/postgres:17.11.0.004; C=fanday-dryrun; D=scripts/shared-impact
W="${DRYRUN_OUT:-$(mktemp -d)}"; mkdir -p "$W"
trap 'docker rm -f $C >/dev/null 2>&1 || true' EXIT
docker rm -f $C >/dev/null 2>&1 || true
docker run -d --pull never --name $C -e POSTGRES_PASSWORD=dryrun -e POSTGRES_HOST=/var/run/postgresql $IMG >/dev/null
for i in $(seq 1 60); do docker exec $C pg_isready -U supabase_admin -q 2>/dev/null && break; sleep 2; done; sleep 5
sa() { docker exec -i $C psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
pg() { docker exec -i $C psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }   # execute_sql runs as postgres. Fanday is applied as PLAIN SQL, never apply_migration
miglog() { sa -At -c "select count(*), coalesce(md5(string_agg(t::text, '|' order by version)),'') from supabase_migrations.schema_migrations t"; }
sa < $D/live-schema-copy.sql 2>&1 | grep -v NOTICE || true
sa < $D/synthetic-rows.sql
MIG0=$(miglog); echo "supabase_migrations.schema_migrations before: $MIG0"
$D/snapshot.sh $C $W/1-before.txt
echo "== apply fanday_0001, fanday_0002, seeds as plain SQL (as postgres, like execute_sql)"
for f in supabase/migrations/fanday_0001_init.sql supabase/migrations/fanday_0002_ingest.sql supabase/seed.sql supabase/seed_teams.sql supabase/seed/teams_tz.sql; do pg < $f; echo "  applied $f"; done
$D/snapshot.sh $C $W/2-after-apply.txt
[ "$(miglog)" = "$MIG0" ] && echo "schema_migrations UNCHANGED after apply ($MIG0)" || { echo "FAIL: supabase_migrations.schema_migrations changed"; exit 1; }
echo "fanday.schema_versions: $(sa -At -c "select string_agg(version, ',' order by version) from fanday.schema_versions")"
if diff -u $W/1-before.txt $W/2-after-apply.txt > $W/diff-apply.txt; then echo "DIFF AFTER APPLY: EMPTY (identical outside fanday)"; else echo "DIFF AFTER APPLY: NOT EMPTY"; cat $W/diff-apply.txt; exit 1; fi
echo "== fanday inventory"; sa -At -c "select 'tables', count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where nspname='fanday' and relkind='r'" -c "select 'functions', count(*) from pg_proc where pronamespace='fanday'::regnamespace" -c "select 'leagues', count(*) from fanday.leagues" -c "select 'teams', count(*) from fanday.teams"
echo "== simulate Fanday sign-ins (synthetic users)"; sa < $D/simulate-fanday-use.sql
echo "== rollback step 1: READ-ONLY preview (what would be deleted)"; pg < $D/rollback-preview.sql | tee $W/preview.txt
echo "== rollback without approval must refuse and drop nothing"
if pg < $D/rollback.sql >/dev/null 2>$W/refused.txt; then echo "FAIL: rollback ran without an approved list"; exit 1; else grep -q 'not on fanday.rollback_approved' $W/refused.txt && echo "refused as expected: $(grep -o 'user [0-9a-f-]* qualifies' $W/refused.txt | head -1)"; fi
[ "$(sa -At -c "select count(*) from pg_namespace where nspname='fanday'")" = 1 ] || { echo "FAIL: schema dropped without approval"; exit 1; }
echo "== rollback step 2: the human approves the previewed list (writes only inside fanday)"
APPROVAL=$(sed -n 's/^ *\(create table if not exists fanday.rollback_approved.*;\) *$/\1/p' $W/preview.txt | head -1); echo "  $APPROVAL"; echo "$APPROVAL" | pg
echo "== rollback step 3: rollback.sql"; pg < $D/rollback.sql 2>&1 | grep -E 'NOTICE|ERROR' || true
# F2 was deliberately KEPT by the rollback (it has a Woofabulary row). Remove the test fixture by hand so the original can be compared.
sa -c "delete from public.user_settings where user_id='00000000-0000-0000-0000-0000000000f2'; delete from auth.users where id='00000000-0000-0000-0000-0000000000f2'"
[ "$(miglog)" = "$MIG0" ] && echo "schema_migrations UNCHANGED after rollback, nothing to clean there" || { echo "FAIL: supabase_migrations changed"; exit 1; }
echo "fanday schema left: $(sa -At -c "select count(*) from pg_namespace where nspname='fanday'")"
$D/snapshot.sh $C $W/3-after-rollback.txt
if diff -u $W/1-before.txt $W/3-after-rollback.txt > $W/diff-rollback.txt; then echo "DIFF AFTER ROLLBACK vs ORIGINAL: EMPTY (identical, fanday gone)"; else echo "DIFF AFTER ROLLBACK: NOT EMPTY"; cat $W/diff-rollback.txt; exit 1; fi
echo "== negative control: one stray grant outside fanday must make the snapshot differ"
sa -c "revoke select on public.languages from anon"
$D/snapshot.sh $C $W/4-negative-control.txt >/dev/null
if diff -q $W/1-before.txt $W/4-negative-control.txt >/dev/null; then echo "NEGATIVE CONTROL FAILED: snapshot did not notice a changed grant"; exit 1; else echo "negative control ok: snapshot detects a one-grant change"; fi
echo "outputs in $W"
