# iOS Simulator CI

`.github/workflows/ios-sim.yml` builds Fanday unsigned for the iOS Simulator on `macos-latest`, boots a current iPhone Pro, grants calendar access, launches, screenshots (launch, +15s, +35s), checks the process is alive and no crash log appeared, and uploads `artifacts/` (screenshots, xcodebuild.log, app-log.txt, crash/).

Cost: macOS minutes bill at 10x on private repos. First (uncached) run: 11m50s, about 120 billed minutes. Cached re-run (run 41607668115): 2m41s, about 30 billed minutes, so about 65 runs a month on 2,000 free private-repo minutes (plan unverified). PR runs only start when the PR has the `ios-sim` label (or by `workflow_dispatch`); npm, SwiftPM and DerivedData are cached.

Runner: defaults to `macos-15-intel` because the arm64 `macos-latest` pool hit capacity limits (jobs never acquired a runner). `workflow_dispatch` has a `runner` input; on PRs add label `ios-sim-arm` to use `macos-latest`. Intel minutes also bill at 10x. Caches are keyed by runner arch. The workflow selects the newest installed Xcode 26.
