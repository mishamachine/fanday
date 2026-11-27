import { SocialLogin } from '@capgo/capacitor-social-login'
import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID, isNative } from './env.ts'

// Native Google sign-in: the OS sheet returns a Google ID token, which supabase.auth.signInWithIdToken exchanges for a session.
// There is no web Google OAuth for Fanday. Plugin: @capgo/capacitor-social-login (pinned), whose docs name Supabase signInWithIdToken
// with a nonce as a supported use. iOS tokens carry the iOS client id as audience; Android tokens carry the WEB client id.
// Both ids must be in the Supabase Google provider's Client IDs list (see the PR).
export const googleAvailable = isNative && !!(GOOGLE_IOS_CLIENT_ID && GOOGLE_WEB_CLIENT_ID)

/** Returns a Google ID token whose nonce claim is `hashedNonce` (the caller keeps the raw nonce for Supabase). */
export async function googleIdToken(hashedNonce: string): Promise<string> {
  await SocialLogin.initialize({ google: { iOSClientId: GOOGLE_IOS_CLIENT_ID, webClientId: GOOGLE_WEB_CLIENT_ID } })
  const res = await SocialLogin.login({ provider: 'google', options: { scopes: ['openid', 'email', 'profile'], nonce: hashedNonce } })
  const r = res.result as { idToken?: string | null }
  if (!r.idToken) throw new Error('Google did not return a token.')
  return r.idToken
}
