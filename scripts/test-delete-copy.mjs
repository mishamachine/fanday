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
ok('no copy still claims "your account" is always deleted or that an anonymous account exists', ![page, policy, settings].some((t) => /everything linked to it from our database|Removes your teams and account data|anonymous account/i.test(t)))
// Retention sentences are only true if the cleanup is scheduled and uses the same numbers.
ok('privacy: unused device codes go after 24 months, claimed or revoked ones within 30 days', /after 24 months without use/.test(policy) && /within 30 days/.test(policy)
  && /cleanup_unused_device_tokens\(24\)/.test(sql) && /interval '30 days'/.test(sql))
ok('those deletions are scheduled: the daily ingest workflow calls maintenance, which runs cleanup and the orphan purge', /"mode":"maintenance"/.test(wf) && /cron: '0 10 \* \* \*'/.test(wf)
  && /run_maintenance[\s\S]*cleanup_unused_device_tokens\(24\)[\s\S]*purge_orphaned_user_rows\(\)/.test(sql))
