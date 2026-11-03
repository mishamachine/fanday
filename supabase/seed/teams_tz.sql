-- Home time zone (IANA) of every MLS team. Run after supabase/seed_teams.sql (PR #1) and migration fanday_0002_ingest.sql (adds teams.tz).
-- The Wikipedia ingest uses it for MLS kickoff times that carry no zone label; with no zone a time stays TBC (it never guesses).
-- Other leagues need no team zone: their pages label the time, or the zone comes from the league, the template or the venue.
-- Idempotent: an UPDATE of one column, safe to re-run. Team ids are from supabase/seed/teams.json on cto/fanday-v1-foundation (aba1937).
update fanday.teams t
   set tz = v.tz
  from (values
  ('mls-atlanta-united-fc', 'America/New_York'),
  ('mls-austin-fc', 'America/Chicago'),
  ('mls-cf-montreal', 'America/New_York'),
  ('mls-charlotte-fc', 'America/New_York'),
  ('mls-chicago-fire-fc', 'America/Chicago'),
  ('mls-colorado-rapids', 'America/Denver'),
  ('mls-columbus-crew', 'America/New_York'),
  ('mls-d-c-united', 'America/New_York'),
  ('mls-fc-cincinnati', 'America/New_York'),
  ('mls-fc-dallas', 'America/Chicago'),
  ('mls-houston-dynamo-fc', 'America/Chicago'),
  ('mls-inter-miami-cf', 'America/New_York'),
  ('mls-la-galaxy', 'America/Los_Angeles'),
  ('mls-los-angeles-fc', 'America/Los_Angeles'),
  ('mls-minnesota-united-fc', 'America/Chicago'),
  ('mls-nashville-sc', 'America/Chicago'),
  ('mls-new-england-revolution', 'America/New_York'),
  ('mls-new-york-city-fc', 'America/New_York'),
  ('mls-new-york-red-bulls', 'America/New_York'),
  ('mls-orlando-city-sc', 'America/New_York'),
  ('mls-philadelphia-union', 'America/New_York'),
  ('mls-portland-timbers', 'America/Los_Angeles'),
  ('mls-real-salt-lake', 'America/Denver'),
  ('mls-san-diego-fc', 'America/Los_Angeles'),
  ('mls-san-jose-earthquakes', 'America/Los_Angeles'),
  ('mls-seattle-sounders-fc', 'America/Los_Angeles'),
  ('mls-sporting-kansas-city', 'America/Chicago'),
  ('mls-st-louis-city-sc', 'America/Chicago'),
  ('mls-toronto-fc', 'America/New_York'),
  ('mls-vancouver-whitecaps-fc', 'America/Los_Angeles')
  ) as v (id, tz)
 where t.id = v.id and t.league_id = 'mls';
