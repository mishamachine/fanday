# iOS Simulator CI

`.github/workflows/ios-sim.yml` builds Fanday unsigned for the iOS Simulator on `macos-latest`, boots a current iPhone Pro, grants calendar access, launches, screenshots (launch and +8s), checks the process is alive and no crash log appeared, and uploads `artifacts/` (screenshots, xcodebuild.log, app-log.txt, crash/).

Cost: macOS minutes bill at 10x on private repos. A 12-minute run bills about 120 of the 2,000 free private-repo minutes, so about 16 runs a month on GitHub Free (plan unverified). PR runs only start when the PR has the `ios-sim` label (or by `workflow_dispatch`); SwiftPM and DerivedData are cached.
