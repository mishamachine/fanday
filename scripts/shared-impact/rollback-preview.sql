-- STEP 1 of the rollback: READ-ONLY preview. Run as role postgres (SQL editor or execute_sql). Changes nothing.
-- Lists exactly which auth users rollback.sql would delete, with email, why each qualifies, and that none owns a row outside `fanday`.
-- Babar or Misha read the list, then run the generated approval statement (last result) to approve exactly these users, then run rollback.sql.
begin read only;

-- A. WOULD BE DELETED: Fanday created the user (fanday.user_origin.created_by_fanday) AND fanday.user_has_foreign_rows() is false
--    (no row in any table outside fanday with a user_id column, Woofabulary's and Chess Tutor's included).
select 'A. would be DELETED' as list, o.user_id, u.email, u.created_at as user_created_at,
       (select string_agg(i.provider, ',' order by i.provider) from auth.identities i where i.user_id = o.user_id) as sign_in_methods,
       'user_origin says Fanday created it (recorded ' || o.created_at::date || ')' as why_it_qualifies,
       fanday.user_has_foreign_rows(o.user_id) as owns_rows_outside_fanday   -- must be false on every line
  from fanday.user_origin o join auth.users u on u.id = o.user_id
 where o.created_by_fanday and not fanday.user_has_foreign_rows(o.user_id)
 order by u.created_at;

-- B. WILL BE KEPT although Fanday created them: they own rows in another app. Never deleted.
select 'B. KEPT (has rows in another app)' as list, o.user_id, u.email, u.created_at as user_created_at
  from fanday.user_origin o join auth.users u on u.id = o.user_id
 where o.created_by_fanday and fanday.user_has_foreign_rows(o.user_id);

-- C. Only an Apple sign-in that Fanday added is removed from an otherwise kept user.
select 'C. APPLE identity unlinked' as list, o.user_id, u.email
  from fanday.user_origin o join auth.users u on u.id = o.user_id
 where not o.created_by_fanday and o.apple_added_by_fanday
   and exists (select 1 from auth.identities i where i.user_id = o.user_id and i.provider = 'apple');

-- D. The approval statement for list A. Run it (it writes only inside schema fanday), then rollback.sql. With an empty list it creates
--    the table and approves nobody.
select 'create table if not exists fanday.rollback_approved (user_id uuid primary key, approved_at timestamptz not null default now()); '
    || coalesce('insert into fanday.rollback_approved (user_id) values ' || (select string_agg('(''' || o.user_id || ''')', ', ' order by o.user_id)
         from fanday.user_origin o join auth.users u on u.id = o.user_id where o.created_by_fanday and not fanday.user_has_foreign_rows(o.user_id)) || ' on conflict do nothing;', '-- (nobody to approve)') as approval_sql;
commit;
