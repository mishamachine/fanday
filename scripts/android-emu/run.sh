#!/usr/bin/env bash
# Fanday Android emulator end-to-end run. Executed inside reactivecircus/android-emulator-runner.
# Inputs : build/apk/base.apk (VITE_QA=1) and build/apk/shift.apk (VITE_QA=1 VITE_QA_SHIFT_MIN=90).
# Outputs: artifacts/ (results.txt, screenshots, dumps, logcat). Exit non-zero if any assertion fails.
set -uo pipefail
PKG="com.bbprojectfactory.fanday"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$PWD/artifacts"; mkdir -p "$OUT"
RES="$OUT/results.txt"; : > "$RES"
CAL_URI="content://com.android.calendar/calendars"
EV_URI="content://com.android.calendar/events"
FAIL=0
pass() { echo "PASS  $1" | tee -a "$RES"; }
fail() { echo "FAIL  $1" | tee -a "$RES"; FAIL=1; }
note() { echo "NOTE  $1" | tee -a "$RES"; }
check() { if [ "$2" = "1" ]; then pass "$1"; else fail "$1${3:+ ($3)}"; fi; }

shot() { adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null || true; }
dump_ui() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/ui-current.xml" >/dev/null 2>&1; }
# wait_text <text> [tries]  -> 0 when visible
wait_text() { local t="$1" n="${2:-20}" i; for ((i=0;i<n;i++)); do dump_ui; python3 "$HERE/ui.py" find "$OUT/ui-current.xml" "$t" >/dev/null && return 0; sleep 2; done; return 1; }
# tap_text <text> [tries]
tap_text() {
  local t="$1" n="${2:-20}" i xy
  for ((i=0;i<n;i++)); do
    dump_ui
    if xy="$(python3 "$HERE/ui.py" find "$OUT/ui-current.xml" "$t")"; then adb shell input tap $xy; sleep 1.5; return 0; fi
    sleep 2
  done
  cp "$OUT/ui-current.xml" "$OUT/ui-notfound-$(echo "$t" | tr -c 'A-Za-z0-9' _).xml" 2>/dev/null
  return 1
}
launch() { adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; }

# Drive onboarding to the games screen. Returns 0 if every step found its button.
onboard() {
  tap_text "Get started" 30 || return 1
  tap_text "NFL" 15 || return 1
  tap_text "Kansas City Chiefs" 15 || return 1
  tap_text "to my calendar" 10 || return 1
  return 0
}

# fanday_cal_id -> numeric id of the "Fanday" local calendar, or empty
fanday_cal_id() {
  adb shell "content query --uri $CAL_URI --projection _id:account_name:calendar_displayName" 2>/dev/null | tr -d '\r' \
    | grep -E 'account_name=Fanday' | sed -n 's/.*_id=\([0-9]*\).*/\1/p' | head -1
}
events_of() { adb shell "content query --uri $EV_URI --projection _id:calendar_id:title:dtstart:dtend:deleted --where 'calendar_id=$1'" 2>/dev/null | tr -d '\r'; }
wait_events() { # wait_events <calId> -> waits until >=1 event row, up to ~60s
  local i; for ((i=0;i<30;i++)); do [ -n "$(events_of "$1" | grep '^Row:')" ] && return 0; sleep 2; done; return 1; }

echo "== device"; adb shell getprop ro.build.version.sdk | tee -a "$OUT/device.txt"
adb logcat -c

echo "== 1a. install, NO calendar grant: rationale screen"
adb install -r build/apk/base.apk > "$OUT/install-base.txt" 2>&1; cat "$OUT/install-base.txt"
adb shell pm revoke "$PKG" android.permission.READ_CALENDAR >/dev/null 2>&1 || true
adb shell pm revoke "$PKG" android.permission.WRITE_CALENDAR >/dev/null 2>&1 || true
launch; sleep 4; shot 01-welcome
if onboard; then
  if wait_text "Add games to your calendar" 20; then pass "rationale screen shown before the OS permission prompt"; else fail "rationale screen shown before the OS permission prompt" "text not found"; fi
else
  fail "rationale screen shown before the OS permission prompt" "onboarding not driven, see ui-notfound-*.xml"
fi
shot 02-rationale; cp "$OUT/ui-current.xml" "$OUT/ui-rationale.xml" 2>/dev/null
check "no Fanday calendar created before permission" "$([ -z "$(fanday_cal_id)" ] && echo 1 || echo 0)"

echo "== 1b. reset app data, grant calendar permissions"
adb shell am force-stop "$PKG"
adb shell pm clear "$PKG" >/dev/null
adb shell pm grant "$PKG" android.permission.READ_CALENDAR
adb shell pm grant "$PKG" android.permission.WRITE_CALENDAR

echo "== 2. seed QA_Other calendar + event"
adb shell "content insert --uri '$CAL_URI?caller_is_syncadapter=true&account_name=QA_Other&account_type=LOCAL' \
  --bind account_name:s:QA_Other --bind account_type:s:LOCAL --bind name:s:QA_Other --bind calendar_displayName:s:QA_Other \
  --bind calendar_color:i:-65536 --bind calendar_access_level:i:700 --bind visible:i:1 --bind sync_events:i:1 --bind owner_account:s:QA_Other" >/dev/null 2>&1
OTHER_ID="$(adb shell "content query --uri $CAL_URI --projection _id:account_name" | tr -d '\r' | grep 'account_name=QA_Other' | sed -n 's/.*_id=\([0-9]*\).*/\1/p' | head -1)"
note "QA_Other calendar id: ${OTHER_ID:-none}"
if [ -n "$OTHER_ID" ]; then
  START=$(( ($(date +%s) + 86400*2) * 1000 )); END=$(( START + 3600000 ))
  adb shell "content insert --uri '$EV_URI?caller_is_syncadapter=true&account_name=QA_Other&account_type=LOCAL' \
    --bind calendar_id:i:$OTHER_ID --bind title:s:QA_Other_event --bind dtstart:l:$START --bind dtend:l:$END --bind eventTimezone:s:UTC" >/dev/null 2>&1
  events_of "$OTHER_ID" > "$OUT/other-before.txt"
  OTHER_BEFORE="$(python3 "$HERE/ui.py" rows "$OUT/other-before.txt")"
  check "seeded one QA_Other event" "$([ "$(echo "$OTHER_BEFORE" | grep -c .)" = "1" ] && echo 1 || echo 0)" "rows: $OTHER_BEFORE"
else
  fail "seeded one QA_Other event" "calendar insert failed"
fi

echo "== 3. launch with permission, onboard"
launch; sleep 4
if onboard; then pass "onboarding driven (Get started, NFL, Kansas City Chiefs, add to calendar)"; else fail "onboarding driven" "see ui-notfound-*.xml"; fi
shot 03-after-onboard

echo "== 4. Fanday calendar and events"
FAN_ID=""; for i in $(seq 1 20); do FAN_ID="$(fanday_cal_id)"; [ -n "$FAN_ID" ] && break; sleep 3; done
adb shell "content query --uri $CAL_URI --projection _id:account_name:account_type:calendar_displayName" | tr -d '\r' > "$OUT/calendars.txt"
check "Fanday calendar exists (account Fanday, LOCAL)" "$([ -n "$FAN_ID" ] && echo 1 || echo 0)"
BEFORE=""; COUNT_BEFORE=0
if [ -n "$FAN_ID" ]; then
  wait_events "$FAN_ID" || true
  events_of "$FAN_ID" > "$OUT/fanday-before.txt"
  BEFORE="$(python3 "$HERE/ui.py" rows "$OUT/fanday-before.txt" | sort)"
  COUNT_BEFORE="$(echo "$BEFORE" | grep -c . || true)"
fi
check "Fanday calendar has events (count=$COUNT_BEFORE)" "$([ "$COUNT_BEFORE" -ge 1 ] && echo 1 || echo 0)"
shot 04-games

echo "== 5. kickoff move: reinstall APK built with VITE_QA_SHIFT_MIN=90"
adb shell am force-stop "$PKG"
adb install -r build/apk/shift.apk > "$OUT/install-shift.txt" 2>&1; cat "$OUT/install-shift.txt"
launch; sleep 8; shot 05-after-shift
AFTER=""; COUNT_AFTER=0
if [ -n "$FAN_ID" ]; then
  for i in $(seq 1 25); do   # wait for the sync to rewrite the moved kickoff
    events_of "$FAN_ID" > "$OUT/fanday-after.txt"
    AFTER="$(python3 "$HERE/ui.py" rows "$OUT/fanday-after.txt" | sort)"
    [ "$AFTER" != "$BEFORE" ] && break; sleep 3
  done
  COUNT_AFTER="$(echo "$AFTER" | grep -c . || true)"
fi
check "same event count after move ($COUNT_BEFORE -> $COUNT_AFTER)" "$([ "$COUNT_BEFORE" -ge 1 ] && [ "$COUNT_BEFORE" = "$COUNT_AFTER" ] && echo 1 || echo 0)"
# same _ID set, and the first mock kickoff (the one with the shifted time) has DTSTART + 90 min
IDS_B="$(echo "$BEFORE" | awk '{print $1}' | tr '\n' ' ')"; IDS_A="$(echo "$AFTER" | awk '{print $1}' | tr '\n' ' ')"
check "same event _ID set (before: $IDS_B / after: $IDS_A)" "$([ -n "$IDS_B" ] && [ "$IDS_B" = "$IDS_A" ] && echo 1 || echo 0)"
MOVED="$(python3 - "$OUT/fanday-before.txt" "$OUT/fanday-after.txt" <<'PY'
import re, sys
def rows(p):
    d = {}
    for l in open(p, errors='replace'):
        if l.startswith('Row:'):
            i = re.search(r'\b_id=(\d+)', l); s = re.search(r'\bdtstart=(\d+)', l)
            if i and s: d[i.group(1)] = int(s.group(1))
    return d
b, a = rows(sys.argv[1]), rows(sys.argv[2])
print(sum(1 for k in b if k in a and a[k] - b[k] == 90 * 60_000))
PY
)"
check "exactly one event has DTSTART + 90 min on the same _ID (moved: ${MOVED:-0})" "$([ "${MOVED:-0}" = "1" ] && echo 1 || echo 0)"

echo "== 6. QA_Other event untouched"
if [ -n "${OTHER_ID:-}" ]; then
  events_of "$OTHER_ID" > "$OUT/other-after.txt"
  OTHER_AFTER="$(python3 "$HERE/ui.py" rows "$OUT/other-after.txt")"
  check "QA_Other event unchanged" "$([ -n "$OTHER_BEFORE" ] && [ "$OTHER_BEFORE" = "$OTHER_AFTER" ] && echo 1 || echo 0)" "before: $OTHER_BEFORE after: $OTHER_AFTER"
else
  fail "QA_Other event unchanged" "not seeded"
fi

echo "== 7. logcat"
PID="$(adb shell pidof "$PKG" | tr -d '\r' | awk '{print $1}')"
adb logcat -d > "$OUT/logcat-full.txt" 2>&1
if [ -n "$PID" ]; then grep -E " $PID +[0-9]+ " "$OUT/logcat-full.txt" > "$OUT/logcat-app.txt" || true; else : > "$OUT/logcat-app.txt"; fi
grep -n "FATAL EXCEPTION" "$OUT/logcat-full.txt" | grep -i . > "$OUT/fatal.txt" || : > "$OUT/fatal.txt"
# a fatal in any Fanday process (including the earlier ones before reinstall) fails the run
FATAL_PKG="$(grep -A3 "FATAL EXCEPTION" "$OUT/logcat-full.txt" | grep -c "$PKG" || true)"
check "no FATAL EXCEPTION for $PKG in logcat" "$([ "${FATAL_PKG:-0}" = "0" ] && echo 1 || echo 0)"
check "app process alive at end" "$([ -n "$PID" ] && echo 1 || echo 0)"

echo; echo "== results"; cat "$RES"
exit $FAIL
