-- SYNTHETIC rows (made up, not copied from live) so row counts in the dry run are non-zero. Ids are fixed so runs are repeatable.
insert into auth.users (id,email,raw_app_meta_data,is_anonymous) values ('00000000-0000-0000-0000-0000000000a1','woof@example.test','{"provider":"google"}',false),('00000000-0000-0000-0000-0000000000a2','chess@example.test','{}',false);
insert into auth.identities (provider_id,user_id,identity_data,provider,email) values ('g1','00000000-0000-0000-0000-0000000000a1','{}','google','woof@example.test');
insert into public.languages (id,code,name,name_native,flag_emoji) values ('11111111-1111-1111-1111-111111111111','xx','Test','Test','x');
insert into public.weeks (id,language_id,number,title,phase,description) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',1,'w','p','d');
insert into public.lessons (id,week_id,language_id,session,title,title_native,description,estimated_minutes) values ('xx-1','22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',1,'t','t','d',5);
insert into public.user_progress (user_id,lesson_id,language_code,quiz_score) values ('00000000-0000-0000-0000-0000000000a1','xx-1','xx',80);
insert into public.user_settings (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.chess_events (session_id,kind) values ('s','move');
