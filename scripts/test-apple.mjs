import { webcrypto as crypto } from 'node:crypto'
import { eq, ok, done } from './_t.mjs'
import { appleConfigFrom, appleClientSecret, revokeAppleAuthorization, appleGate } from '../supabase/functions/delete-account/apple.ts'

// A throwaway P-256 key made right here for the test. Not a real Apple key.
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64')
const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`
const env = (o) => (k) => o[k]

eq('no secrets: skipped cleanly', appleConfigFrom(env({})), null)
eq('partial secrets: skipped cleanly', appleConfigFrom(env({ APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K' })), null)
const cfg = appleConfigFrom(env({ APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_PRIVATE_KEY: pem.replace(/\n/g, '\\n') }))
ok('all three secrets (with \\n-escaped key): config built', !!cfg && cfg.privateKey.includes('\n'))

const jwt = await appleClientSecret(cfg, 'com.bbprojectfactory.fanday', 1_800_000_000)
const [h, b, s] = jwt.split('.')
const dec = (x) => JSON.parse(Buffer.from(x, 'base64url').toString())
eq('header', dec(h), { alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' })
eq('claims', dec(b), { iss: 'TEAM123456', iat: 1_800_000_000, exp: 1_800_000_300, aud: 'https://appleid.apple.com', sub: 'com.bbprojectfactory.fanday' })
ok('signature verifies with the public key', await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${b}`)))

// Revoke flow against a fake Apple.
const calls = []
const fakeApple = (tokenOk, revokeOk) => async (url, init) => {
  calls.push([String(url), Object.fromEntries(init.body)])
  if (String(url).endsWith('/auth/token')) return new Response(JSON.stringify({ refresh_token: 'RT' }), { status: tokenOk ? 200 : 400 })
  return new Response('', { status: revokeOk ? 200 : 400 })
}
eq('revoke ok', await revokeAppleAuthorization(cfg, 'com.bbprojectfactory.fanday', 'CODE', fakeApple(true, true)), true)
eq('exchanged the code, then revoked the refresh token', [calls[0][0], calls[0][1].code, calls[1][0], calls[1][1].token, calls[1][1].token_type_hint],
  ['https://appleid.apple.com/auth/token', 'CODE', 'https://appleid.apple.com/auth/revoke', 'RT', 'refresh_token'])
eq('bad code: false, no revoke call', await revokeAppleAuthorization(cfg, 'x', 'BAD', fakeApple(false, true)), false)
eq('revoke rejected: false', await revokeAppleAuthorization(cfg, 'x', 'CODE', fakeApple(true, false)), false)

// Fail closed: an Apple user is never deleted unless secrets exist and a code was sent.
eq('non-Apple user passes with no secrets', appleGate(false, null, undefined).ok, true)
const g1 = appleGate(true, null, 'CODE')
eq('Apple user, secrets missing: refused 503, nothing deleted', [g1.ok, g1.status, g1.code], [false, 503, 'apple_not_configured'])
const g2 = appleGate(true, cfg, undefined)
eq('Apple user, no authorization code: refused 409', [g2.ok, g2.status, g2.code], [false, 409, 'apple_code_required'])
eq('Apple user, empty code: refused', appleGate(true, cfg, '').ok, false)
eq('Apple user, secrets and code: gate passes (revoke still has to succeed)', appleGate(true, cfg, 'CODE').ok, true)
done()
