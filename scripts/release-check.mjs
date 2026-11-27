// Blocks a public release of the sign-in (store build or site) until the release flags in release/signin-release-flags.json are cleared.
// Rule: (the daily maintenance job has run green on schedule, shown by a heartbeat row, OR other apps' account deletion removes Fanday rows)
//       AND the native calendar change has landed (the "Fanday removes its calendar from that phone" sentence is then true).
// The code half (job exists, heartbeat is written) is checked here; the manual half is the flags file. Exits 1 until cleared.
import { readFileSync } from 'node:fs'
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const flags = JSON.parse(process.argv[2] ? readFileSync(process.argv[2], 'utf8') : read('release/signin-release-flags.json'))
const sql = read('supabase/migrations/fanday_0001_init.sql'), wf = read('.github/workflows/ingest.yml')
const problems = []
if (!/create table if not exists fanday\.maintenance_runs/.test(sql) || !/insert into fanday\.maintenance_runs/.test(sql)) problems.push('run_maintenance does not write the heartbeat row (fanday.maintenance_runs)')
if (!/"mode":"maintenance"/.test(wf)) problems.push('the daily workflow does not call the maintenance job')
const cleanup = flags.maintenance_job_green_on_schedule === true || flags.other_apps_deletion_removes_fanday_rows === true
if (!cleanup) problems.push('neither maintenance_job_green_on_schedule nor other_apps_deletion_removes_fanday_rows is set: Fanday rows of a sign-in deleted in another app would not be removed')
if (flags.maintenance_job_green_on_schedule === true && !flags.maintenance_job_green_on_schedule_evidence) problems.push('maintenance_job_green_on_schedule is true but has no evidence (last heartbeat row, run link)')
if (flags.other_apps_deletion_removes_fanday_rows === true && !flags.other_apps_deletion_removes_fanday_rows_evidence) problems.push('other_apps_deletion_removes_fanday_rows is true but has no evidence')
if (flags.native_calendar_pr_landed !== true) problems.push('native_calendar_pr_landed is not set: the calendar-removal sentence in the privacy policy and terms is not true yet')
else if (!flags.native_calendar_pr_landed_evidence) problems.push('native_calendar_pr_landed is true but has no evidence')
// Phases: the plan must hold the close (phase 1) and open (phase 2) scripts for every signed-in entry point; declaring phase 2 needs them intact.
const FUNCS = ['ensure_profile()', 'claim_device(text)', 'user_follows_add(text[])', 'user_device_upsert(uuid, text, text, text)', 'user_calendar_upsert(uuid, jsonb)', 'user_log_event(text)']
const close = read('scripts/shared-impact/phase1-close-signin.sql'), open2 = read('scripts/shared-impact/phase2-open-signin.sql'), steps = read('docs/apply-steps.md')
const missingClose = FUNCS.filter((f) => !close.includes(`fanday.${f}`) || !/revoke execute/.test(close)), missingOpen = FUNCS.filter((f) => !open2.includes(`fanday.${f}`) || !/grant execute/.test(open2))
if (missingClose.length) problems.push('phase1-close-signin.sql does not revoke: ' + missingClose.join(', '))
if (!/Phase 1/.test(steps) || !/Phase 2/.test(steps)) problems.push('docs/apply-steps.md has no Phase 1 / Phase 2 sections')
if (flags.signin_phase === 2 && missingOpen.length) problems.push('signin_phase is 2 but phase2-open-signin.sql does not grant: ' + missingOpen.join(', '))
if (flags.signin_phase !== 1 && flags.signin_phase !== 2) problems.push('signin_phase must be 1 or 2')
if (problems.length) { console.error('RELEASE BLOCKED:\n- ' + problems.join('\n- ')); process.exit(1) }
console.log('release check passed')
