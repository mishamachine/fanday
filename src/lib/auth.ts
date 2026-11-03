import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { SignInWithApple } from '@capacitor-community/apple-sign-in'
import type { Provider, User } from '@supabase/supabase-js'
import { APP_SCHEME, BUNDLE_ID, FUNCTIONS_URL, SUPABASE_KEY, isNative, platform } from './env.ts'
import { supabase } from './supabase.ts'
import { authRedirect, parseCallbackUrl, randomNonce, sha256Hex } from './authUtil.ts'

// All three sign-in methods are optional. The app starts on an anonymous Supabase session.
// FOLLOW-KEEPING (decision): we do NOT use linkIdentity. It needs "manual linking" switched on in the project, fails
// when the email/Google/Apple account already exists, and cannot be used with signInWithOtp or native signInWithIdToken.
// Instead, before any sign-in we ask the server for a one-time claim token (create_merge_claim, anonymous caller only).
// After sign-in the new user redeems it (claim_anonymous_follows), which moves follows and devices from the old
// anonymous uid. The token proves the caller controlled that anonymous session. See 0001_init.sql.

const CLAIM_KEY = 'fanday.mergeClaim'
const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
  del: (k: string) => { try { localStorage.removeItem(k) } catch { /* private mode */ } },
}

const redirectTo = () => authRedirect(isNative, APP_SCHEME, window.location.origin)
const need = () => { if (!supabase) throw new Error('Sign-in is not available in this build.'); return supabase }

export const isAnonymous = (u: User | null | undefined) => !!u && (u as User & { is_anonymous?: boolean }).is_anonymous === true

export async function ensureAnonymousSession(): Promise<User | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  if (data.session) return data.session.user
  const { data: anon, error } = await supabase.auth.signInAnonymously()
  if (error) { console.warn('Anonymous sign-in failed', error.message); return null }
  return anon.user
}

/** If we are anonymous, leave a claim token behind so the next real sign-in can take our follows with it. */
async function prepareMerge() {
  const sb = need()
  const { data } = await sb.auth.getUser()
  if (!isAnonymous(data.user)) return
  const { data: token, error } = await sb.rpc('create_merge_claim')
  if (error) { console.warn('create_merge_claim failed', error.message); return }
  store.set(CLAIM_KEY, String(token))
}

/** Call after a real (non-anonymous) session exists. Safe to call repeatedly. */
export async function redeemMergeClaim(): Promise<boolean> {
  const token = store.get(CLAIM_KEY)
  if (!token || !supabase) return false
  const { data } = await supabase.auth.getUser()
  if (!data.user || isAnonymous(data.user)) return false
  const { error } = await supabase.rpc('claim_anonymous_follows', { p_token: token })
  store.del(CLAIM_KEY) // one-time token: used or dead either way
  if (error) { console.warn('claim_anonymous_follows failed', error.message); return false }
  return true
}

export async function signInWithEmail(email: string) {
  const sb = need()
  await prepareMerge()
  const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo(), shouldCreateUser: true } })
  if (error) throw error
}

export async function signInWithOAuth(provider: Extract<Provider, 'google' | 'apple'>) {
  const sb = need()
  await prepareMerge()
  const { data, error } = await sb.auth.signInWithOAuth({
    provider, options: { redirectTo: redirectTo(), skipBrowserRedirect: isNative, scopes: provider === 'google' ? 'openid email profile' : 'name email' },
  })
  if (error) throw error
  if (isNative && data.url) await Browser.open({ url: data.url }) // returns through appUrlOpen -> handleAuthUrl
}

/** iOS: native Apple sheet, then signInWithIdToken. Elsewhere: Apple web OAuth in the system browser. */
export async function signInWithApple() {
  if (platform !== 'ios') return signInWithOAuth('apple')
  const sb = need()
  await prepareMerge()
  const raw = randomNonce()
  const res = await SignInWithApple.authorize({ clientId: BUNDLE_ID, redirectURI: '', scopes: 'email name', nonce: await sha256Hex(raw) })
  const idToken = res.response.identityToken
  if (!idToken) throw new Error('Apple did not return a token.')
  const { error } = await sb.auth.signInWithIdToken({ provider: 'apple', token: idToken, nonce: raw })
  if (error) throw error
  await redeemMergeClaim()
}

/** Handle the app deep link (native) after Google/Apple OAuth or a magic link. */
export async function handleAuthUrl(url: string): Promise<boolean> {
  const parsed = parseCallbackUrl(url, APP_SCHEME)
  if (!parsed || !supabase) return false
  if (isNative) await Browser.close().catch(() => undefined)
  if (parsed.error) throw new Error(parsed.error)
  if (parsed.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(parsed.code)
    if (error) throw error
    await redeemMergeClaim()
  }
  return true
}

export function initAuthListeners(onChange: (user: User | null) => void) {
  if (!supabase) return () => undefined
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    onChange(session?.user ?? null)
    // detectSessionInUrl (web) lands here without going through handleAuthUrl.
    if (session?.user && !isAnonymous(session.user)) void redeemMergeClaim()
  })
  const urlHandle = isNative
    ? App.addListener('appUrlOpen', (e) => { void handleAuthUrl(e.url).catch((err) => console.warn('auth callback', err)) })
    : null
  return () => { sub.subscription.unsubscribe(); void urlHandle?.then((h) => h.remove()) }
}

export async function signOut() {
  if (!supabase) return
  await supabase.auth.signOut()
  store.del(CLAIM_KEY)
  await ensureAnonymousSession()
}

/**
 * Delete account: the Edge Function deletes the auth user (rows go by cascade) and revokes the Apple token.
 * Apple revocation needs a fresh authorization code, so Apple-linked users on iOS re-confirm with Apple first.
 */
export async function deleteAccount(user: User | null): Promise<void> {
  const sb = need()
  const { data } = await sb.auth.getSession()
  if (!data.session) throw new Error('Not signed in.')
  let appleCode: string | undefined
  const hasApple = (user?.identities ?? []).some((i) => i.provider === 'apple')
  if (hasApple && platform === 'ios') {
    const res = await SignInWithApple.authorize({ clientId: BUNDLE_ID, redirectURI: '', scopes: '' })
    appleCode = res.response.authorizationCode
  }
  const r = await fetch(`${FUNCTIONS_URL}/delete-account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}`, apikey: SUPABASE_KEY },
    body: JSON.stringify({ confirm: 'DELETE', apple_authorization_code: appleCode, apple_client_id: appleCode ? BUNDLE_ID : undefined }),
  })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Could not delete the account. Nothing was deleted.')
  await sb.auth.signOut({ scope: 'local' })
}
