-- STEP 3 of the rollback for the SHARED project. Run as role postgres, ONLY after rollback-preview.sql was read
-- and its approval statement was run by the project owner. One transaction; safe to re-run (a second run finds no `fanday` schema).
-- It removes ONLY what Fanday made, and ONLY users on the approved list (fanday.rollback_approved):
--   1. Auth users that Fanday created AND that own nothing outside `fanday` AND are on the approved list. Deleting the user cascades to its
--      auth.identities, sessions and refresh tokens, exactly as GoTrue's own delete does. If such a user is NOT on the approved list the
--      whole script aborts and nothing is dropped (run the preview again). A Fanday-created user who ALSO owns another app's rows is KEPT.
--   2. Apple identities that a Fanday sign-in added to a user we keep (apple_added_by_fanday) are unlinked.
--   3. drop schema fanday cascade (tables, functions, policies, grants, seed data, schema_versions: all inside the schema).
-- Nothing is written to supabase_migrations (Fanday was applied as plain SQL), public or any other app's objects. NOT done here
-- (dashboard / CLI, docs/apply-steps.md): exposed-schemas entry (do this FIRST), Edge Functions fanday-*, FANDAY_* secrets,
-- Fanday redirect URLs, Google client IDs appended, Apple provider.
begin;
do $$
declare r record; n_del int := 0; n_keep int := 0; n_apple int := 0; approved uuid[] := '{}';
begin
  if to_regnamespace('fanday') is null then
    raise notice 'schema fanday not present: nothing to roll back';
    return;
  end if;
  if to_regclass('fanday.rollback_approved') is not null then
    select coalesce(array_agg(user_id), '{}') into approved from fanday.rollback_approved;
  end if;
  if to_regclass('fanday.user_origin') is not null then
    for r in select user_id, created_by_fanday, apple_added_by_fanday from fanday.user_origin loop
      if r.created_by_fanday then
        if exists (select 1 from auth.users u where u.id = r.user_id) then
          if fanday.user_has_foreign_rows(r.user_id) then
            n_keep := n_keep + 1; raise notice 'KEEP user % (Fanday created it but it has rows in another app)', r.user_id;
          elsif not (r.user_id = any (approved)) then
            raise exception 'user % qualifies for deletion but is not on fanday.rollback_approved: run rollback-preview.sql and get the list approved', r.user_id;
          else
            delete from auth.users where id = r.user_id; n_del := n_del + 1;
          end if;
        end if;
      elsif r.apple_added_by_fanday then
        delete from auth.identities where user_id = r.user_id and provider = 'apple'; n_apple := n_apple + 1;
      end if;
    end loop;
  end if;
  raise notice 'auth users deleted: %, kept: %, apple identities unlinked: %', n_del, n_keep, n_apple;
end $$;
drop schema if exists fanday cascade;
commit;
