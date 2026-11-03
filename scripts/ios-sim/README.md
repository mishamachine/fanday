# iOS Simulator CI

`.github/workflows/ios-sim.yml` builds Fanday unsigned for the iOS Simulator on `macos-latest`, boots a current iPhone Pro, grants calendar access, launches, screenshots (launch and +8s), checks the process is alive and no crash log appeared, and uploads `artifacts/` (screenshots, xcodebuild.log, app-log.txt, crash/).

Cost: macOS minutes bill at 10x on private repos (about 200 free macOS min/month). Expect about 10-15 runner minutes per run, so 100-150 billed. Use `workflow_dispatch` sparingly.
