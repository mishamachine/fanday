import { eq, ok, done } from './_t.mjs'
import { authRedirect, parseCallbackUrl, randomNonce, sha256Hex, isEmail } from '../src/lib/authUtil.ts'

const S = 'com.bbprojectfactory.fanday'
eq('native redirect is the app deep link', authRedirect(true, S, 'http://localhost'), `${S}://auth/callback`)
eq('web redirect is the site origin', authRedirect(false, S, 'https://fanday.bbprojectfactory.com'), 'https://fanday.bbprojectfactory.com')
eq('code parsed', parseCallbackUrl(`${S}://auth/callback?code=abc`, S), { code: 'abc', error: undefined })
eq('error parsed', parseCallbackUrl(`${S}://auth/callback?error=access_denied&error_description=No`, S)?.error, 'No')
eq('other scheme ignored', parseCallbackUrl('https://evil.example/auth/callback?code=abc', S), null)
eq('other host ignored', parseCallbackUrl(`${S}://other/callback?code=abc`, S), null)
eq('no code, no error: ignored', parseCallbackUrl(`${S}://auth/callback`, S), null)
eq('garbage ignored', parseCallbackUrl('::::', S), null)
eq('sha256 known vector', await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
ok('nonce is random hex', /^[0-9a-f]{32}$/.test(randomNonce()) && randomNonce() !== randomNonce())
eq('emails', ['a@b.co', 'a@b', ' x y@z.com'].map(isEmail), [true, false, false])
done()
