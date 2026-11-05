-- Fanday rollback for the SHARED project (ref ywcrzkvwamjchjjkfrve). Run once, as role postgres (Supabase SQL editor, or apply_migration by a human).
-- One transaction; safe to re-run (a second run finds no `fanday` schema and does nothing).
-- It removes ONLY what Fanday made:
--   1. Auth users that Fanday created (fanday.user_origin.created_by_fanday) AND that own nothing outside `fanday` (fanday.user_has_foreign_rows).
--      Deleting the user cascades to its auth.identities, sessions and refresh tokens, exactly as GoTrue's own delete does.
--      A Fanday-created user who ALSO has Woofabulary/Chess rows is KEPT (and reported in a NOTICE): never delete a person's other-app data.
--   2. Apple identities that a Fanday sign-in added to a user we keep (apple_added_by_fanday) are unlinked.
--   3. drop schema fanday cascade  (tables, functions, policies, grants and the seed data, all inside the schema).
-- It never touches public, Woofabulary or Chess Tutor objects. NOT done here (dashboard / CLI, see docs/shared-db-impact.md):
--   Edge Functions fanday-*, FANDAY_* secrets, exposed-schemas entry `fanday`, Fanday redirect URLs, Google client IDs appended, Apple provider.
begin;
do $$
declare r record; n_del int := 0; n_keep int := 0; n_apple int := 0;
begin
  if to_regnamespace('fanday') is null then
    raise notice 'schema fanday not present: nothing to roll back';
    return;
  end if;
  if to_regclass('fanday.user_origin') is not null then
    for r in select user_id, created_by_fanday, apple_added_by_fanday from fanday.user_origin loop
      if r.created_by_fanday then
        if exists (select 1 from auth.users u where u.id = r.user_id) then
          if fanday.user_has_foreign_rows(r.user_id) then
            n_keep := n_keep + 1; raise notice 'KEEP user % (Fanday created it but it has rows in another app)', r.user_id;
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
