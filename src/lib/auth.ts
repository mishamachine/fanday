import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { SignInWithApple } from '@capacitor-community/apple-sign-in'
import type { User } from '@supabase/supabase-js'
import { APPLE_SERVICES_ID, APP_SCHEME, BUNDLE_ID, FUNCTIONS_URL, SUPABASE_KEY, SUPABASE_URL, isNative, platform } from './env.ts'
import { getAppleWebAuthorizationCode } from './appleWeb.ts'
import { supabase } from './supabase.ts'
import { authRedirect, emailRedirect, parseCallbackUrl, randomNonce, sha256Hex } from './authUtil.ts'
import { forgetDeviceToken, getDeviceToken } from './deviceToken.ts'
import { googleIdToken } from './googleNative.ts'

// All sign-in methods are optional. Signed-out users have NO Supabase session (anonymous sign-ins are off on the shared project):
// their follows are keyed to a server-issued device token (deviceToken.ts). On the first sign-in the new user redeems that token
// with fanday.claim_device(), which moves the device's follows, calendar devices and events to the user and kills the token.
// Profiles are created lazily by fanday.ensure_profile() (no trigger on auth.users).

const redirectTo = () => authRedirect(isNative, APP_SCHEME, window.location.origin)
const need = () => { if (!supabase) throw new Error('Sign-in is not available in this build.'); return supabase }

/** Existing session, if any. Never creates one. */
export async function currentUser(): Promise<User | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user ?? null
}

let afterRunning: Promise<void> | null = null
/** After any sign-in: make the profile row, then take over this phone's signed-out data. Safe to repeat. */
export function afterSignIn(): Promise<void> {
  afterRunning ??= (async () => {
    const sb = supabase
    if (!sb) return
    const { error: pErr } = await sb.rpc('ensure_profile')
    if (pErr) console.warn('ensure_profile failed', pErr.message)
    const token = await getDeviceToken()
    if (!token) return
    const { error } = await sb.rpc('claim_device', { p_token: token })
    // Used, revoked or unknown token: it is dead either way. A network failure keeps it for the next try.
    if (!error || error.code === '42501' || error.code === '28000') await forgetDeviceToken()
    if (error) console.warn('claim_device failed', error.message)
  })().finally(() => { afterRunning = null })
  return afterRunning
}

/**
 * Email link: fanday-send-link (our own function, Gmail SMTP) makes the link and mails it. The reply is always the same, whether or not
 * the address has an account. The link opens the app with ?token_hash=...&type=magiclink, which handleAuthUrl verifies.
 */
export async function signInWithEmail(email: string) {
  need()
  const r = await fetch(`${FUNCTIONS_URL}/fanday-send-link`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
    body: JSON.stringify({ email: email.trim(), redirect: emailRedirect(isNative) }),
  })
  if (!r.ok) throw new Error('Could not send the sign-in email. Try again in a little while.')
}

/** Apple on web/Android: OAuth in the system browser (Apple's web flow). Google has no web path. */
export async function signInWithAppleWeb() {
  const sb = need()
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'apple', options: { redirectTo: redirectTo(), skipBrowserRedirect: isNative, scopes: 'name email' },
  })
  if (error) throw error
  if (isNative && data.url) await Browser.open({ url: data.url }) // returns through appUrlOpen -> handleAuthUrl
}

/** iOS: native Apple sheet, then signInWithIdToken. Elsewhere: Apple web OAuth in the system browser. */
export async function signInWithApple() {
  if (platform !== 'ios') return signInWithAppleWeb()
  const sb = need()
  const raw = randomNonce()
  const res = await SignInWithApple.authorize({ clientId: BUNDLE_ID, redirectURI: '', scopes: 'email name', nonce: await sha256Hex(raw) })
  const idToken = res.response.identityToken
  if (!idToken) throw new Error('Apple did not return a token.')
  const { error } = await sb.auth.signInWithIdToken({ provider: 'apple', token: idToken, nonce: raw })
  if (error) throw error
  await afterSignIn()
}

/** Google, native only: OS sheet -> ID token -> signInWithIdToken. */
export async function signInWithGoogle() {
  const sb = need()
  const raw = randomNonce()
  const idToken = await googleIdToken(await sha256Hex(raw))
  const { error } = await sb.auth.signInWithIdToken({ provider: 'google', token: idToken, nonce: raw })
  if (error) throw error
  await afterSignIn()
}

/** Handle the app deep link (native): the emailed link (?token_hash) or Apple web OAuth (?code). */
export async function handleAuthUrl(url: string): Promise<boolean> {
  const parsed = parseCallbackUrl(url, APP_SCHEME)
  if (!parsed || !supabase) return false
  if (isNative) await Browser.close().catch(() => undefined)
  if (parsed.error) throw new Error(parsed.error)
  if (parsed.tokenHash) {
    // The link token is only spent here, so a mail scanner that fetches the link cannot use it up.
    const { error } = await supabase.auth.verifyOtp({ token_hash: parsed.tokenHash, type: parsed.otpType ?? 'magiclink' })
    if (error) throw error
    await afterSignIn()
  } else if (parsed.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(parsed.code)
    if (error) throw error
    await afterSignIn()
  }
  return true
}

export function initAuthListeners(onChange: (user: User | null) => void) {
  if (!supabase) return () => undefined
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    onChange(session?.user ?? null)
    // detectSessionInUrl (web) lands here without going through handleAuthUrl. Deferred: no Supabase calls inside this callback.
    if (session?.user) setTimeout(() => { void afterSignIn() }, 0)
  })
  const urlHandle = isNative
    ? App.addListener('appUrlOpen', (e) => { void handleAuthUrl(e.url).catch((err) => console.warn('auth callback', err)) })
    : null
  return () => { sub.subscription.unsubscribe(); void urlHandle?.then((h) => h.remove()) }
}

export async function signOut() {
  if (!supabase) return
  await supabase.auth.signOut()
}

/**
 * Delete account.
 * Signed out: fanday.device_delete(token) removes every row of this device and revokes the token. No Edge Function needed.
 * Signed in: fanday-delete-account always deletes the user's Fanday rows and revokes Apple; it deletes the auth user only if Fanday
 * created it and it owns nothing in another app (the project is shared), otherwise it only unlinks Fanday.
 * Apple-linked users must give a fresh authorization code at delete time: iOS re-confirms with the native Apple sheet,
 * web and Android with Sign in with Apple JS (needs VITE_APPLE_SERVICES_ID). The server FAILS CLOSED: if Apple can't be
 * revoked it deletes nothing, and we surface that message here.
 */
export async function deleteAccount(user: User | null): Promise<void> {
  const sb = need()
  if (!user) {
    const token = await getDeviceToken()
    if (token) {
      const { error } = await sb.rpc('device_delete', { p_token: token })
      if (error && error.code !== '28000') throw new Error('Could not delete your data. Nothing was deleted; try again.')
      await forgetDeviceToken()
    }
    return
  }
  const { data } = await sb.auth.getSession()
  if (!data.session) throw new Error('Not signed in.')
  let appleCode: string | undefined
  let appleClient: string | undefined
  let appleRedirect: string | undefined
  if ((user.identities ?? []).some((i) => i.provider === 'apple')) {
    if (platform === 'ios') {
      const res = await SignInWithApple.authorize({ clientId: BUNDLE_ID, redirectURI: '', scopes: '' })
      appleCode = res.response.authorizationCode
      appleClient = BUNDLE_ID
    } else {
      if (!APPLE_SERVICES_ID) throw new Error('Deleting an account that uses Apple sign-in is not available in this build. Nothing was deleted.')
      appleRedirect = `${SUPABASE_URL}/auth/v1/callback` // same string goes to Apple's authorize call and to the server's token exchange
      appleCode = await getAppleWebAuthorizationCode(APPLE_SERVICES_ID, appleRedirect)
      appleClient = APPLE_SERVICES_ID
    }
    if (!appleCode) throw new Error('Apple did not confirm. Nothing was deleted.')
  }
  const r = await fetch(`${FUNCTIONS_URL}/fanday-delete-account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}`, apikey: SUPABASE_KEY },
    body: JSON.stringify({ confirm: 'DELETE', apple_authorization_code: appleCode, apple_client_id: appleClient, apple_redirect_uri: appleRedirect }),
  })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Could not delete the account. Nothing was deleted.')
  await sb.auth.signOut({ scope: 'local' })
}
