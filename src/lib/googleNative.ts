import { registerPlugin } from '@capacitor/core'
import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID, isNative } from './env.ts'

// Native Google sign-in: the OS sheet returns a Google ID token, which supabase.auth.signInWithIdToken exchanges for a session.
// There is no web Google OAuth for Fanday. The plugin API below is that of `@capgo/capacitor-social-login`
// (initialize + login({provider:'google'}) -> result.idToken). DEPENDENCY NOT ADDED BY THIS PR (needs Al-Jazari's OK), and the call
// shapes are [unverified] until it is installed: with no plugin or no client ids the Google button is simply not shown.
interface SocialLoginPlugin {
  initialize(o: { google: { iOSClientId?: string; webClientId?: string } }): Promise<void>
  login(o: { provider: 'google'; options: { scopes: string[]; nonce?: string } }): Promise<{ result: { idToken?: string | null } }>
}
const plugin = registerPlugin<SocialLoginPlugin>('SocialLogin')

export const googleAvailable = isNative && !!(GOOGLE_IOS_CLIENT_ID || GOOGLE_WEB_CLIENT_ID)

/** Returns a Google ID token whose nonce claim is the sha256 of `hashedNonce`'s preimage (caller keeps the raw nonce for Supabase). */
export async function googleIdToken(hashedNonce: string): Promise<string> {
  await plugin.initialize({ google: { iOSClientId: GOOGLE_IOS_CLIENT_ID || undefined, webClientId: GOOGLE_WEB_CLIENT_ID || undefined } })
  const res = await plugin.login({ provider: 'google', options: { scopes: ['openid', 'email', 'profile'], nonce: hashedNonce } })
  const t = res.result.idToken
  if (!t) throw new Error('Google did not return a token.')
  return t
}
