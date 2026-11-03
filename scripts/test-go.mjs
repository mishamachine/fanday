import { eq, ok, done } from './_t.mjs'
import { parseGoPath, resolveTarget, sponsorActive } from '../supabase/functions/go/target.ts'

const ID = 'aaaaaaaa-0000-0000-0000-000000000001'
eq('parses functions path', parseGoPath(`/functions/v1/go/${ID}/watch`), { gameId: ID, slot: 'watch' })
eq('parses bare path', parseGoPath(`/go/${ID}/tickets`), { gameId: ID, slot: 'tickets' })
eq('sponsor slot ok', parseGoPath(`/go/${ID}/sponsor`)?.slot, 'sponsor')
eq('unknown slot rejected', parseGoPath(`/go/${ID}/bogus`), null)
eq('non-uuid game rejected', parseGoPath('/go/1 or 1=1/watch'), null)
eq('extra segments rejected', parseGoPath(`/go/${ID}/watch/extra`), null)
eq('missing slot rejected', parseGoPath(`/go/${ID}`), null)

const row = { watch_url: 'https://watch.example/p?aff=123', tickets_url: 'https://tix.example/e', sponsor_url: null, sponsor: { url: 'https://acme.example' } }
const w = new URL(resolveTarget(row, 'watch'))
eq('watch: stored url + utm, affiliate tag kept', [w.host, w.searchParams.get('aff'), w.searchParams.get('utm_source'), w.searchParams.get('utm_medium'), w.searchParams.get('utm_campaign')], ['watch.example', '123', 'fanday', 'calendar', 'watch'])
eq('tickets: stored url', new URL(resolveTarget(row, 'tickets')).host, 'tix.example')
eq('sponsor falls back to the sponsor row', new URL(resolveTarget(row, 'sponsor')).host, 'acme.example')
eq('empty slot has no target', resolveTarget({ ...row, tickets_url: null }, 'tickets'), null)
eq('missing game has no target', resolveTarget(null, 'watch'), null)

// Not an open redirect: only stored https URLs ever leave; junk stored values are refused.
eq('http refused', resolveTarget({ ...row, watch_url: 'http://watch.example/' }, 'watch'), null)
eq('javascript: refused', resolveTarget({ ...row, watch_url: 'javascript:alert(1)' }, 'watch'), null)
eq('credentials in url refused', resolveTarget({ ...row, watch_url: 'https://a:b@evil.example/' }, 'watch'), null)
eq('garbage refused', resolveTarget({ ...row, watch_url: 'not a url' }, 'watch'), null)
ok('the resolver takes no caller-supplied URL', resolveTarget.length === 2)

// Sponsor window (inclusive UTC dates).
const NOW = new Date('2026-11-10T12:00:00Z')
const sp = (starts_on, ends_on) => ({ ...row, sponsor_url: null, sponsor: { url: 'https://acme.example', starts_on, ends_on } })
eq('window: open bounds active', sponsorActive({ starts_on: null, ends_on: null }, NOW), true)
eq('window: starts today is active', sponsorActive({ starts_on: '2026-11-10', ends_on: null }, NOW), true)
eq('window: ends today is active', sponsorActive({ starts_on: null, ends_on: '2026-11-10' }, NOW), true)
eq('window: not started', sponsorActive({ starts_on: '2026-11-11', ends_on: null }, NOW), false)
eq('window: ended yesterday', sponsorActive({ starts_on: null, ends_on: '2026-11-09' }, NOW), false)
eq('expired sponsor: no redirect', resolveTarget(sp('2026-01-01', '2026-11-09'), 'sponsor', NOW), null)
eq('future sponsor: no redirect', resolveTarget(sp('2026-12-01', null), 'sponsor', NOW), null)
eq('active sponsor redirects', new URL(resolveTarget(sp('2026-11-01', '2026-12-01'), 'sponsor', NOW)).host, 'acme.example')
eq('expired sponsor blocks even the games own sponsor_url', resolveTarget({ ...sp(null, '2026-01-01'), sponsor_url: 'https://own.example' }, 'sponsor', NOW), null)
eq('watch/tickets unaffected by an expired sponsor', new URL(resolveTarget(sp(null, '2026-01-01'), 'watch', NOW)).host, 'watch.example')
done()
