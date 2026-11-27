-- PHASE 1 (ingest only): close every signed-in entry point. Run as role postgres right after fanday_0001 and fanday_0002 are applied.
-- Re-running fanday_0001_init.sql re-grants these functions (its grant statements are part of the file): run this file again after any re-run.
-- Signed-out device RPCs and the ingest functions are not touched.
revoke execute on function fanday.ensure_profile(), fanday.claim_device(text), fanday.user_follows_add(text[]), fanday.user_device_upsert(uuid, text, text, text), fanday.user_calendar_upsert(uuid, jsonb), fanday.user_log_event(text) from anon, authenticated;
