# Fanday
Your games. Your calendar. That's it. Capacitor 8 + React 18 + Vite 5 + Supabase (shared Supabase project, schema `fanday`).

```
cp .env.example .env.local   # publishable client key only; no other secret belongs in this repo
npm install && npm run dev   # mock data by default; VITE_DATA_SOURCE=supabase reads the real tables
npm run build && npm test    # build = tsc + vite; tests need Node >= 22.18 (runs .ts directly) and use pglite for the migration
npm run build:native         # then: npx cap open ios | android
```

- `src/data/`: `DataSource` seam (mock now, `supabaseSource` reads leagues/teams/games).
- `src/calendar/`: native calendar plugin interface + in-memory mock + event title/notes builder. TODO: native EventKit / CalendarContract plugin.
- `src/lib/auth.ts`: sign-in is optional (magic link, Google PKCE, Apple). Signed-out installs have no Supabase session: the server issues a random device token (`fanday.issue_device_token`, only its sha256 is stored) and the app reads and writes through token RPCs (`device_*`). On first sign-in `fanday.claim_device(token)` moves that device's follows, devices (at most 5 per user) and usage rows to the user and kills the token (single use). Signed-in writes go through capped RPCs (`user_*`); see the file headers.
- `supabase/`: `migrations/fanday_0001_init.sql` and `fanday_0002_ingest.sql` (schema `fanday` only; RLS on every table), seeds, `config.toml`, Edge Functions `fanday-ingest`, `fanday-delete-account`, `fanday-go`, `fanday-send-link`, `fanday-device`. The project is shared with other apps: nothing here is applied or deployed by CI, and nothing may touch another app (proof: `npm run test:migrations`). Apply steps: `docs/apply-steps.md`.
- Palette and screens: `design/fanday-screens.html` in the project folder. No team or league logos; badges are text.
