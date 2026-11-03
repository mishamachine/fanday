# Seed data
- `teams.json`: source of truth for `seed_teams.sql` (`node scripts/build-teams-seed.mjs`). Built from Wikipedia on 2026-11-02.
- `official-calendar-links.json`: the NBA/NHL official calendar links (62). **Verified 2026-11-03** (each URL returned HTTP 200; the four `.ics` feeds by HEAD only). Copied from the CTO's project folder; the same URLs are in `teams.json` (`official_calendar_url`), matched on team name ("LA Clippers" = "Los Angeles Clippers"). Re-verify before launch: links can move.
