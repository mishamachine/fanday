// The delete and retention wording must be the same in the app, on the delete page and in the privacy policy, and must match what the code does.
import { ok } from './_t.mjs'
import { readFileSync } from 'node:fs'
import { DELETE_SIGNED_IN, DELETE_SIGNED_OUT } from '../src/lib/deleteCopy.ts'
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const page = read('site/src/delete.html'), policy = read('site/legal/privacy-policy.md'), settings = read('src/screens/Settings.tsx')
const wf = read('.github/workflows/ingest.yml'), sql = read('supabase/migrations/fanday_0001_init.sql')

ok('delete page carries the signed-in and signed-out sentences word for word', page.includes(DELETE_SIGNED_IN) && page.includes(DELETE_SIGNED_OUT))
ok('privacy policy section 8 carries the same sentences', policy.includes(DELETE_SIGNED_IN) && policy.includes(DELETE_SIGNED_OUT))
ok('the app shows them (both, chosen by sign-in state)', /DELETE_SIGNED_IN/.test(settings) && /DELETE_SIGNED_OUT/.test(settings) && /user \? DELETE_SIGNED_IN : DELETE_SIGNED_OUT/.test(settings))
ok('no copy still claims "your account" is always deleted or that an anonymous account exists', ![page, policy, settings, read('site/legal/terms-of-use.md')].some((t) => /everything linked to it from our database|Removes your teams and account data|anonymous account/i.test(t)))
// Retention: the policy promises only what is true today. Time-based deletion claims for device codes are NOT made (legal ruling); the cleanup job
// still runs. If such a claim returns, the release flag in release/signin-release-flags.json must be cleared first.
const flags = JSON.parse(read('release/signin-release-flags.json'))
const claims = /after 24 months without use|We delete the old code within 30 days|within 30 days of (your )?(sign|claim)/i
ok('privacy: states what is kept for a device code, with no 24-month or 30-day device-code claim (unless the maintenance flag is cleared)',
  /We keep the teams and calendars linked to a device code until you delete them in the app\. When you sign in on a device, they move to your account and the device code stops working\./.test(policy)
  && (!claims.test(policy) || flags.maintenance_job_green_on_schedule === true))
ok('privacy: the shared sign-in names only Woof and BoboLearns Hub',
  policy.includes('Fanday uses the same B&B Project Factory sign-in as Woof and BoboLearns Hub, so one account works in all three. Each app keeps its own data.') && !/Chess Tutor/.test(policy))
ok('privacy: unused device codes may be deleted (no time figure), and the manual-deletion sentence is the legal text', policy.includes("We may also delete device codes that haven't been used for a long time, with the teams and calendars linked to them.")
  && policy.includes("Apart from removing unused device codes, and Fanday data for sign-ins deleted in our other apps, these deletions are done by us, not by an automatic process. We'll update this policy when more of it is automatic. If you want your data gone sooner, delete your account (section 8)."))
ok('the cleanup still runs daily (maintenance in the workflow, heartbeat row written)', /"mode":"maintenance"/.test(wf) && /cron: '0 10 \* \* \*'/.test(wf)
  && /run_maintenance[\s\S]*cleanup_unused_device_tokens\(24\)[\s\S]*purge_orphaned_user_rows\(\)[\s\S]*insert into fanday\.maintenance_runs/.test(sql))
ok('claimed or revoked device codes are removed after 29 days (so "within 30 days" would hold with a daily run)', /coalesce\(revoked_at, claimed_at\) < now\(\) - interval '29 days'/.test(sql))

// Terms (word for word)
const terms = read('site/legal/terms-of-use.md')
for (const line of [
  '- You can use Fanday without an account. On your device it keeps a random device code, not an account. If you sign in, you use the same B&B Project Factory sign-in as Woof and BoboLearns Hub.',
  '- You can delete your Fanday data at any time in the app (Settings → Delete account) or by emailing machinemisha+fanday@gmail.com. What happens to your sign-in is explained in our Privacy Policy.',
  '- If you delete your Fanday data in the app, Fanday removes its calendar from that phone.',
  'You can stop using Fanday and delete your Fanday data at any time.',
]) ok(`terms: ${line.slice(0, 50)}...`, terms.includes(line))
ok('terms: no anonymous-account or delete-your-account claim', ![terms].some((t) => /anonymous account|delete your account/i.test(t)))
