-- PHASE 2 (sign-in opens): give the signed-in entry points back. Run as role postgres ONLY after `npm run release:check` passes.
-- This is exactly what fanday_0001_init.sql grants; running 0001 again has the same effect.
grant execute on function fanday.ensure_profile(), fanday.user_follows_add(text[]), fanday.user_device_upsert(uuid, text, text, text),
  fanday.user_calendar_upsert(uuid, jsonb), fanday.user_log_event(text) to authenticated;
grant execute on function fanday.claim_device(text) to authenticated;
