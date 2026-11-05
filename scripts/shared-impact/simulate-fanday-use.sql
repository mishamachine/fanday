-- Simulates what Fanday does to the shared auth tables, using SYNTHETIC users, after the migrations are applied.
-- F1: a brand-new Google user who only uses Fanday  -> rollback must delete it.
-- F2: a brand-new Google user who later also gets a Woofabulary row -> rollback must KEEP it (we then clean it by hand in the test).
-- W1: the existing synthetic Woofabulary user (…a1) signs in to Fanday with a fresh Apple identity -> rollback must unlink only that Apple identity.
insert into auth.users (id,email,raw_app_meta_data,created_at) values
  ('00000000-0000-0000-0000-0000000000f1','f1@example.test','{}',now()),('00000000-0000-0000-0000-0000000000f2','f2@example.test','{}',now());
insert into auth.identities (provider_id,user_id,identity_data,provider,email,created_at) values
  ('gf1','00000000-0000-0000-0000-0000000000f1','{}','google','f1@example.test',now()),
  ('gf2','00000000-0000-0000-0000-0000000000f2','{}','google','f2@example.test',now()),
  ('ap1','00000000-0000-0000-0000-0000000000a1','{}','apple','woof@example.test',now());
do $$ declare u text; begin
  foreach u in array array['00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000a1'] loop
    perform set_config('request.jwt.claim.sub', u, true);
    perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
    set local role authenticated;
    perform fanday.ensure_profile();
    reset role;
  end loop;
end $$;
insert into public.user_settings (user_id) values ('00000000-0000-0000-0000-0000000000f2');  -- F2 now also owns an other-app row
select user_id, created_by_fanday, apple_added_by_fanday from fanday.user_origin order by 1;
