-- Leagues seed (README, 2026-11-02). `season` = the newest season whose Wikipedia pages exist (checked 2026-11-03); the ingest reads it as is,
-- so for off-season leagues it must be raised by hand (or by a later job) when the next season's pages appear. Idempotent. NBA/NHL use official team calendar links; MLB, WNBA, IPL, NRL are
-- off-season (in_season=false): pickable now, games arrive when the schedule is published. Teams: seed_teams.sql.
insert into public.leagues (id, name, country, country_code, sport, season, source, tz, in_season, sort) values
  ('epl',         'Premier League',      'England',   'GB', 'soccer',            '2026-27', 'wikipedia',     'Europe/London',            true,   10),
  ('nfl',         'NFL',                 'USA',       'US', 'american_football', '2026',    'wikipedia',     'America/New_York',         true,   20),
  ('nba',         'NBA',                 'USA',       'US', 'basketball',        '2026-27', 'official_link', 'America/New_York',         true,   30),
  ('wnba',        'WNBA',                'USA',       'US', 'basketball',        '2026',    'wikipedia',     'America/New_York',         false,  40),
  ('mlb',         'MLB',                 'USA',       'US', 'baseball',          '2027',    'wikipedia',     'America/New_York',         false,  50),
  ('nhl',         'NHL',                 'USA',       'US', 'hockey',            '2026-27', 'official_link', 'America/New_York',         true,   60),
  ('mls',         'MLS',                 'USA',       'US', 'soccer',            '2026',    'wikipedia',     'America/New_York',         true,   70),
  ('ncaaf',       'NCAA Football',       'USA',       'US', 'american_football', '2026',    'wikipedia',     'America/New_York',         true,   80),
  ('ncaab',       'NCAA Basketball',     'USA',       'US', 'basketball',        '2026-27', 'wikipedia',     'America/New_York',         true,   90),
  ('laliga',      'La Liga',             'Spain',     'ES', 'soccer',            '2026-27', 'wikipedia',     'Europe/Madrid',            true,  100),
  ('seriea',      'Serie A',             'Italy',     'IT', 'soccer',            '2026-27', 'wikipedia',     'Europe/Rome',              true,  110),
  ('bundesliga',  'Bundesliga',          'Germany',   'DE', 'soccer',            '2026-27', 'wikipedia',     'Europe/Berlin',            true,  120),
  ('ligue1',      'Ligue 1',             'France',    'FR', 'soccer',            '2026-27', 'wikipedia',     'Europe/Paris',             true,  130),
  ('ucl',         'Champions League',    'Europe',    'EU', 'soccer',            '2026-27', 'wikipedia',     'Europe/Paris',             true,  140),
  ('ligamx',      'Liga MX',             'Mexico',    'MX', 'soccer',            '2026-27', 'wikipedia',     'America/Mexico_City',      true,  150),
  ('brasileirao', 'Brasileirao Serie A', 'Brazil',    'BR', 'soccer',            '2026',    'wikipedia',     'America/Sao_Paulo',        true,  160),
  ('ipl',         'IPL',                 'India',     'IN', 'cricket',           '2026',    'wikipedia',     'Asia/Kolkata',             false, 170),
  ('afl',         'AFL',                 'Australia', 'AU', 'aussie_rules',      '2027',    'wikipedia',     'Australia/Melbourne',      true,  180),
  ('nrl',         'NRL',                 'Australia', 'AU', 'rugby_league',      '2026',    'wikipedia',     'Australia/Sydney',         false, 190)
on conflict (id) do update set name = excluded.name, country = excluded.country, country_code = excluded.country_code,
  sport = excluded.sport, season = excluded.season, source = excluded.source, tz = excluded.tz,
  in_season = excluded.in_season, sort = excluded.sort;
