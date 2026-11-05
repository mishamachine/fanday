#!/usr/bin/env bash
# Before/after checks that Woofabulary and Chess Tutor still behave the same on the SHARED project (ref ywcrzkvwamjchjjkfrve).
# READ-ONLY by default: GETs, OPTIONS, and POSTs that are refused before any write or paid call (wrong Origin -> 403). Nothing is stored, nothing costs money.
#   Usage:  SUPABASE_PUBLISHABLE_KEY=sb_publishable_... scripts/shared-impact/check-other-apps.sh > before.txt
#           ...apply...   ;   same command > after.txt   ;   diff before.txt after.txt
#   The publishable key is the public one that Woofabulary and Chess Tutor ship in their web bundles. Never pass a secret/service key to this script.
# Optional (env):  WOOF_ACCESS_TOKEN=<a signed-in Woofabulary user's access token>  adds own-row READS for user_progress/settings/activity/saved.
#                  ROUNDTRIP=1  (with the token) adds ONE write: sets your own user_settings.daily_goal_minutes to the value it already has.
#                  WITH_FANDAY=1 adds Fanday's own reads (these are EXPECTED to change after apply: not exposed before, 19 leagues after).
# Output has no timestamps/keys so before/after diff cleanly. Expected diff after apply: only the apple parts of the two auth/settings lines (false -> true) [and WITH_FANDAY lines].
set -uo pipefail
REF="${SUPABASE_REF:-ywcrzkvwamjchjjkfrve}"; URL="https://$REF.supabase.co"
KEY="${SUPABASE_PUBLISHABLE_KEY:?set SUPABASE_PUBLISHABLE_KEY to the public publishable key}"
case "$KEY" in sb_secret*|*service_role*) echo "refusing: that looks like a secret key" >&2; exit 2;; esac
WOOF_ORIGIN="${WOOF_ORIGIN:-https://woof.bobolearns.com}"; CHESS_ORIGIN="${CHESS_ORIGIN:-https://chess.bobolearns.com}"
sha() { shasum -a 256 | cut -c1-16; }
say() { printf '%s\n' "$*"; }
get() { curl -sS -m 20 -H "apikey: $KEY" "$@"; }                      # body only
code() { curl -sS -m 20 -o /dev/null -w '%{http_code}' "$@"; }
total() { get -D - -o /dev/null -H "Prefer: count=exact" -H "Range: 0-0" "$URL/rest/v1/$1" | tr -d '\r' | awk -F/ 'tolower($0) ~ /^content-range/ {print $2}'; }

say "== WOOFABULARY: public reads, exactly as the app makes them (anon/publishable key)"
L=$(get "$URL/rest/v1/languages?select=id,code,name,name_native,is_live")
say "languages: rows=$(jq length <<<"$L") codes=$(jq -r '[.[].code]|sort|join(",")' <<<"$L") live=$(jq -r '[.[]|select(.is_live)|.code]|sort|join(",")' <<<"$L")"
say "count weeks=$(total weeks) lessons=$(total lessons) lesson_summaries=$(total lesson_summaries)"
LS=$(get "$URL/rest/v1/lesson_summaries?select=id,session,title,title_native,tags,estimated_minutes,week_number,week_title,week_phase,language_code&language_code=eq.es&order=week_number,session")
say "lesson_summaries(es): rows=$(jq length <<<"$LS") body_sha=$(sha <<<"$LS")"
FIRST=$(jq -r '.[0].id' <<<"$LS")
LE=$(get "$URL/rest/v1/lessons?select=id,session,title,title_native,description,estimated_minutes,vocabulary,grammar,phrases,quiz,cultural_note,pronunciation_tip,languages(code),weeks(number,title)&id=eq.$FIRST")
say "lesson $FIRST (with languages+weeks embeds): rows=$(jq length <<<"$LE") vocab=$(jq '.[0].vocabulary|length' <<<"$LE") phrases=$(jq '.[0].phrases|length' <<<"$LE") quiz=$(jq '.[0].quiz|length' <<<"$LE") body_sha=$(sha <<<"$LE")"
say "== WOOFABULARY: what a signed-out visitor must NOT get (RLS/grants unchanged)"
for t in user_progress user_settings daily_activity saved_lessons lessons_backup_20261021; do
  r=$(curl -sS -m 20 -w ' [%{http_code}]' -H "apikey: $KEY" "$URL/rest/v1/$t?select=*&limit=1"); say "anon $t: $(printf '%s' "$r" | cut -c1-140)"
done
say "== PostgREST default schema (adding 'fanday' to exposed schemas must keep 'public' the default, i.e. the FIRST in the list)"
say "no Accept-Profile (default): $(code "$URL/rest/v1/languages?select=id&limit=1" -H "apikey: $KEY")   Accept-Profile: public: $(code "$URL/rest/v1/languages?select=id&limit=1" -H "apikey: $KEY" -H "Accept-Profile: public")   (OpenAPI root is closed to publishable keys, so it is not compared)"
say "== AUTH: project settings (public endpoint)"
AS=$(get "$URL/auth/v1/settings"); jq -S -c '{external:(.external|to_entries|map(select(.key!="email" or true))|from_entries), disable_signup, mailer_autoconfirm, phone_autoconfirm, sms_provider}' <<<"$AS" | sed 's/^/auth\/v1\/settings: /'
say "external.google: $(jq -r '.external.google' <<<"$AS")   external.apple: $(jq -r '.external.apple' <<<"$AS")   external.email: $(jq -r '.external.email' <<<"$AS")"
say "auth health: $(code "$URL/auth/v1/health" -H "apikey: $KEY")"
say "== AUTH: Google web sign-in still starts with the SAME Google client (Woofabulary's), same callback"
LOC=$(curl -sS -m 20 -o /dev/null -w '%{redirect_url}' -H "apikey: $KEY" "$URL/auth/v1/authorize?provider=google&redirect_to=$WOOF_ORIGIN")
say "authorize(google) host=$(printf '%s' "$LOC" | sed -E 's#(https://[^/?]+).*#\1#') client_id=$(printf '%s' "$LOC" | sed -nE 's/.*[?&]client_id=([^&]+).*/\1/p') redirect_uri=$(printf '%s' "$LOC" | sed -nE 's/.*[?&]redirect_uri=([^&]+).*/\1/p') scope=$(printf '%s' "$LOC" | sed -nE 's/.*[?&]scope=([^&]+).*/\1/p')"
say "== SITES reachable"; say "woofabulary $WOOF_ORIGIN: $(code -I "$WOOF_ORIGIN")   chess $CHESS_ORIGIN: $(code -I "$CHESS_ORIGIN")"

if [ -n "${WOOF_ACCESS_TOKEN:-}" ]; then
  say "== WOOFABULARY: signed-in OWN-ROW reads (token supplied; counts only)"
  for t in user_progress user_settings daily_activity saved_lessons; do
    n=$(curl -sS -m 20 -D - -o /dev/null -H "apikey: $KEY" -H "Authorization: Bearer $WOOF_ACCESS_TOKEN" -H "Prefer: count=exact" -H "Range: 0-0" "$URL/rest/v1/$t?select=*" | tr -d '\r' | awk -F/ 'tolower($0) ~ /^content-range/ {print $2}'); say "signed-in $t: own rows=$n"
  done
  if [ "${ROUNDTRIP:-0}" = 1 ]; then
    say "== ROUNDTRIP (ONE WRITE to your own row, same value)"
    cur=$(curl -sS -m 20 -H "apikey: $KEY" -H "Authorization: Bearer $WOOF_ACCESS_TOKEN" "$URL/rest/v1/user_settings?select=daily_goal_minutes")
    g=$(jq -r '.[0].daily_goal_minutes // empty' <<<"$cur")
    if [ -n "$g" ]; then
      res=$(curl -sS -m 20 -X PATCH -H "apikey: $KEY" -H "Authorization: Bearer $WOOF_ACCESS_TOKEN" -H "Content-Type: application/json" -H "Prefer: return=representation" "$URL/rest/v1/user_settings?daily_goal_minutes=eq.$g" -d "{\"daily_goal_minutes\":$g}")
      say "user_settings PATCH same value ($g): rows_returned=$(jq length <<<"$res") value_after=$(jq -r '.[0].daily_goal_minutes' <<<"$res")"
    else say "no user_settings row for this user: skipped"; fi
  fi
else say "(no WOOF_ACCESS_TOKEN: signed-in reads skipped; see docs/shared-db-impact.md section 3 for the manual round trip)"; fi

say "== CHESS TUTOR: the 5 edge functions (Origin $CHESS_ORIGIN; nothing written, nothing paid)"
for f in chess-coach chess-voice chess-log chess-tts chess-snap; do
  h=$(curl -sS -m 20 -X OPTIONS -D - -o /dev/null -H "apikey: $KEY" -H "Origin: $CHESS_ORIGIN" -H "Access-Control-Request-Method: POST" "$URL/functions/v1/$f" | tr -d '\r')
  say "$f OPTIONS: $(head -1 <<<"$h" | awk '{print $2}') allow-origin=$(awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}' <<<"$h") allow-methods=$(awk -F': ' 'tolower($1)=="access-control-allow-methods"{print $2}' <<<"$h")"
done
for f in chess-coach chess-voice chess-tts; do say "$f GET (config only, no upstream call): $(curl -sS -m 20 -w ' [%{http_code}]' -H "apikey: $KEY" -H "Origin: $CHESS_ORIGIN" "$URL/functions/v1/$f")"; done
for f in chess-coach chess-voice chess-log chess-tts chess-snap; do
  say "$f POST from a foreign Origin (must be refused before any write/paid call): $(curl -sS -m 20 -X POST -w ' [%{http_code}]' -H "apikey: $KEY" -H "Origin: https://not-allowed.invalid" -H "Content-Type: application/json" -d '{}' "$URL/functions/v1/$f")"
done
say "chess-tts GET ?say= from a foreign Referer (refused before the paid call): $(curl -sS -m 20 -w ' [%{http_code}]' -H "apikey: $KEY" -H "Referer: https://not-allowed.invalid/" "$URL/functions/v1/chess-tts?say=check")"
say "== CHESS TUTOR: tables as a browser sees them (RLS on, no policies: the app writes only through the functions' service role)"
for t in chess_events chess_frames; do say "anon read $t: $(curl -sS -m 20 -w ' [%{http_code}]' -H "apikey: $KEY" "$URL/rest/v1/$t?select=id&limit=1")"; done

if [ "${WITH_FANDAY:-0}" = 1 ]; then
  say "== FANDAY (expected to CHANGE after apply)"
  say "fanday.leagues via Accept-Profile: $(curl -sS -m 20 -w ' [%{http_code}]' -H "apikey: $KEY" -H "Accept-Profile: fanday" "$URL/rest/v1/leagues?select=id&limit=3" | cut -c1-160)"
fi
