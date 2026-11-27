// The release gate blocks until cleared, and refuses a flag without evidence.
import { ok } from './_t.mjs'
import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const dir = mkdtempSync(join(tmpdir(), 'rel-'))
const run = (flags) => { const f = join(dir, 'f.json'); writeFileSync(f, JSON.stringify(flags)); return spawnSync('node', ['scripts/release-check.mjs', f], { encoding: 'utf8' }) }
const cleared = { maintenance_job_green_on_schedule: true, maintenance_job_green_on_schedule_evidence: 'heartbeat row', native_calendar_pr_landed: true, native_calendar_pr_landed_evidence: 'merged' }
ok('the checked-in flags block a release today', spawnSync('node', ['scripts/release-check.mjs'], { encoding: 'utf8' }).status === 1)
ok('all flags false -> blocked', run({}).status === 1)
ok('cleanup cleared but calendar not -> blocked', run({ ...cleared, native_calendar_pr_landed: false }).status === 1)
ok('calendar cleared but no cleanup -> blocked', run({ native_calendar_pr_landed: true, native_calendar_pr_landed_evidence: 'm' }).status === 1)
ok('a true flag without evidence -> blocked', run({ ...cleared, maintenance_job_green_on_schedule_evidence: '' }).status === 1)
ok('cleanup by other apps\' deletion plus calendar -> passes', run({ other_apps_deletion_removes_fanday_rows: true, other_apps_deletion_removes_fanday_rows_evidence: 'e', native_calendar_pr_landed: true, native_calendar_pr_landed_evidence: 'm' }).status === 0)
ok('maintenance green plus calendar -> passes', run(cleared).status === 0)
