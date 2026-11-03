#!/usr/bin/env bash
# Build Fanday for the iOS Simulator (unsigned), launch it, screenshot, check for crashes.
# Output goes to artifacts/. Exit non-zero if build fails, the app is not alive, or a crash log appears.
set -uo pipefail
BUNDLE_ID="com.bbprojectfactory.fanday"
OUT="$PWD/artifacts"; mkdir -p "$OUT"
DD="$PWD/build/ios"

echo "== xcodebuild"
set -o pipefail
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$DD" -clonedSourcePackagesDirPath "$PWD/build/spm" -skipPackagePluginValidation CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build \
  > "$OUT/xcodebuild.log" 2>&1 || { tail -60 "$OUT/xcodebuild.log"; echo "BUILD FAILED"; exit 1; }
APP="$(find "$DD/Build/Products" -maxdepth 2 -name 'App.app' | head -1)"
[ -n "$APP" ] || { echo "App.app not found"; exit 1; }

echo "== pick simulator"
xcrun simctl list devices available > "$OUT/devices.txt"
UDID="$(xcrun simctl list devices available -j | python3 -c '
import json,sys
d=json.load(sys.stdin)["devices"]
c=[]
for rt,ds in d.items():
    if "iOS" not in rt: continue
    for x in ds:
        if x["name"].startswith("iPhone") and "Pro" in x["name"] and "Max" not in x["name"]:
            c.append((rt,x["name"],x["udid"]))
c.sort()
print(c[-1][2] if c else "")')"
[ -n "$UDID" ] || { echo "no iPhone simulator found"; cat "$OUT/devices.txt"; exit 1; }
echo "simulator $UDID"

xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
xcrun simctl privacy "$UDID" grant calendar "$BUNDLE_ID"
xcrun simctl install "$UDID" "$APP"

FAIL=0
START="$(date +%s)"
xcrun simctl launch "$UDID" "$BUNDLE_ID" | tee "$OUT/launch.txt"
sleep 3
xcrun simctl io "$UDID" screenshot "$OUT/01-launch.png"
sleep 8
xcrun simctl io "$UDID" screenshot "$OUT/02-after-8s.png"

echo "== process alive?"
if xcrun simctl spawn "$UDID" launchctl list | grep -q "$BUNDLE_ID"; then
  echo "alive" | tee "$OUT/alive.txt"
else
  echo "NOT RUNNING" | tee "$OUT/alive.txt"; FAIL=1
fi

echo "== crash logs"
mkdir -p "$OUT/crash"
find "$HOME/Library/Logs/DiagnosticReports" -type f \( -name 'App*' -o -name '*Fanday*' \) -newermt "@$START" -exec cp {} "$OUT/crash/" \; 2>/dev/null
xcrun simctl spawn "$UDID" log show --last 2m --style compact --predicate 'process == "App"' > "$OUT/app-log.txt" 2>&1 || true
if [ -n "$(ls -A "$OUT/crash" 2>/dev/null)" ]; then echo "CRASH LOG FOUND"; FAIL=1; fi

# Native calendar plugin (other PR): note presence only; a driven flow can be added once it merges.
if grep -rqi "calendar" ios/App/CapApp-SPM/Package.swift 2>/dev/null; then
  echo "calendar plugin present in SPM package" | tee "$OUT/calendar-plugin.txt"
fi
exit $FAIL
