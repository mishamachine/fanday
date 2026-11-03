import { FUNCTIONS_URL, SUPABASE_KEY } from './env.ts'
import { secureStore } from './secureStore.ts'

// Signed-out users have no Supabase session at all (anonymous sign-ins are OFF on the shared project). The server issues a random
// token once (fanday-device); we keep it in secure storage and send it to the fanday.device_* RPCs, which store only its sha256.
const KEY = 'fanday.deviceToken'
let pending: Promise<string | null> | null = null

export const isTokenShape = (t: unknown): t is string => typeof t === 'string' && /^[0-9a-f]{64}$/.test(t)

export async function getDeviceToken(): Promise<string | null> {
  const t = await secureStore.get(KEY)
  return isTokenShape(t) ? t : null
}

/** The stored token, or a freshly issued one. Null when offline or when issuing is refused; callers then keep follows on the device only. */
export function ensureDeviceToken(): Promise<string | null> {
  if (!FUNCTIONS_URL) return Promise.resolve(null)
  pending ??= (async () => {
    const have = await getDeviceToken()
    if (have) return have
    try {
      const r = await fetch(`${FUNCTIONS_URL}/fanday-device`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY }, body: JSON.stringify({ action: 'register' }),
      })
      if (!r.ok) return null
      const { token } = await r.json().catch(() => ({}))
      if (!isTokenShape(token)) return null
      await secureStore.set(KEY, token)
      return token
    } catch { return null }
  })().finally(() => { pending = null })
  return pending
}

export const forgetDeviceToken = () => secureStore.remove(KEY)
