# Fanday
Your games. Your calendar. That's it. Capacitor 8 + React 18 + Vite 5 + Supabase (shared project `ywcrzkvwamjchjjkfrve`, schema `fanday`).

```
cp .env.example .env.local   # publishable client key only; no other secret belongs in this repo
npm install && npm run dev   # mock data by default; VITE_DATA_SOURCE=supabase reads the real tables
npm run build && npm test    # build = tsc + vite; tests need Node >= 22.18 (runs .ts directly) and use pglite for the migration
npm run build:native         # then: npx cap open ios | android
```

- `src/data/`: `DataSource` seam (mock now, `supabaseSource` reads leagues/teams/games).
- `src/calendar/`: native calendar plugin interface + in-memory mock + event title/notes builder. TODO: native EventKit / CalendarContract plugin.
- `src/lib/auth.ts`: anonymous session, magic link, Google (PKCE, system browser), Apple (native on iOS). Follows survive sign-in through `create_merge_claim()` / `claim_anonymous_follows()` (SECURITY DEFINER, one-time token), not `linkIdentity`; reasons are in the file header.
- `supabase/`: `migrations/fanday_0001_init.sql` and `fanday_0002_ingest.sql` (schema `fanday` only; RLS on every table), seeds, `config.toml`, Edge Functions `fanday-ingest`, `fanday-delete-account`, `fanday-go`, `fanday-send-link`, `fanday-device`. The project is shared with Woofabulary and Chess Tutor: nothing here is applied or deployed by CI or by agents, and nothing may touch another app (proof: `npm run test:migrations`).
- Palette and screens: `design/fanday-screens.html` in the project folder. No team or league logos; badges are text.
