// Sign in with Apple JS: gets a fresh one-time authorization code on web and Android (where there is no native Apple
// sheet) so delete-account can revoke the Apple grant server-side. Popup mode; the redirect URI is the Supabase callback
// already registered as a Return URL for the Services ID (auth-setup-checklist.md section 2). Not yet run against Apple [unverified].
const SRC = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'

interface AppleIDGlobal {
  auth: {
    init(cfg: { clientId: string; scope: string; redirectURI: string; usePopup: boolean }): void
    signIn(): Promise<{ authorization: { code: string } }>
  }
}

function loadScript(): Promise<AppleIDGlobal> {
  const w = window as unknown as { AppleID?: AppleIDGlobal }
  if (w.AppleID) return Promise.resolve(w.AppleID)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SRC
    s.onload = () => (w.AppleID ? resolve(w.AppleID) : reject(new Error('Apple sign-in did not load.')))
    s.onerror = () => reject(new Error('Could not reach Apple. Check your connection and try again.'))
    document.head.appendChild(s)
  })
}

export async function getAppleWebAuthorizationCode(servicesId: string, redirectURI: string): Promise<string> {
  const apple = await loadScript()
  apple.auth.init({ clientId: servicesId, scope: '', redirectURI, usePopup: true })
  try {
    const res = await apple.auth.signIn()
    return res.authorization.code
  } catch (e) {
    const code = (e as { error?: string }).error
    throw new Error(code === 'popup_closed_by_user' ? 'Apple confirmation was cancelled. Nothing was deleted.' : 'Apple confirmation failed. Nothing was deleted.')
  }
}
