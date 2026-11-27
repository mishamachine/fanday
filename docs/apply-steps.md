# Applying Fanday to a shared Supabase project

Everything Fanday adds to the database lives in the schema `fanday`. Nothing in this repository is applied or deployed by CI.
`npm run test:migrations` proves, against a stand-in of a shared project, that applying the migrations changes nothing outside `fanday`.

## Phases

- **Phase 1, ingest only.** Apply the migrations and seeds, then run `scripts/shared-impact/phase1-close-signin.sql`: it revokes execute on `ensure_profile`, `claim_device`, `user_follows_add`, `user_device_upsert`, `user_calendar_upsert` and `user_log_event` from `anon` and `authenticated`, so nobody can sign in to Fanday data yet. The ingest, go and device functions work as usual.
  Re-running `fanday_0001_init.sql` re-grants those functions: run the phase 1 file again after any re-run.
- **Phase 2, sign-in.** Only after the release gate below passes: run `scripts/shared-impact/phase2-open-signin.sql` (the re-grants), then ship the store build or site that offers sign-in. Set `signin_phase` to 2 in `release/signin-release-flags.json`; `npm run release:check` then also checks that the phase 2 file holds all the grants.

## Apply order (each step by the project owner, stopping at the first surprise)

1. Dashboard: add `fanday` to the Data API exposed schemas (keep the existing ones, `public` first).
2. Run `supabase/migrations/fanday_0001_init.sql`, then `fanday_0002_ingest.sql`, then the seeds (`seed.sql`, `seed_teams.sql`, `seed/teams_tz.sql`) as plain SQL
   (SQL editor or `execute_sql`). Never `apply_migration`, `db push` or `db reset`: those write to the shared migrations table. Every file records itself in `fanday.schema_versions`.
3. Insert the sha256 of one secret per function into `fanday.function_secrets` (names `ingest`, `go`, `device`); set the matching `FANDAY_*_SECRET` values as function secrets. Never store a secret itself.
4. Deploy the Edge Functions `fanday-*`. Set the repository secret `FANDAY_INGEST_SECRET` for the ingest workflow.
5. The ingest workflow calls `fanday-ingest` on a schedule; its daily run also calls `{"mode":"maintenance"}`, which runs `fanday.run_maintenance` (unused device codes, orphaned user rows).
6. Add the Fanday redirect URLs and the sign-in client IDs in the Auth settings by hand (append, never reorder or remove existing entries).

## Rollback

Dashboard first: remove `fanday` from the exposed schemas, undo the Auth additions, delete the `fanday-*` functions and their secrets.
Then, as role `postgres`: `scripts/shared-impact/rollback-preview.sql` (read-only; lists the sign-in users it would delete), approve the list it prints, then `scripts/shared-impact/rollback.sql`.
Sign-in users that also own rows in another app are kept; Apple identities added through Fanday are unlinked.

## Release gate for the sign-in (store or site)

`npm run release:check` fails until the conditions are cleared. It is not part of `npm test`, because it is meant to fail until release time.

- The daily maintenance job must have run green on schedule (read the latest row of `fanday.maintenance_runs`), or other apps' account deletion must remove Fanday rows.
- The native calendar change must have landed, so the sentence about removing Fanday's calendar from the phone is true.

The manual conditions are flags in `release/signin-release-flags.json`. The release owner sets a flag to true and writes the evidence next to it; the script refuses a true flag without evidence.
