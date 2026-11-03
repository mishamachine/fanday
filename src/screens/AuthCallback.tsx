import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { handleAuthUrl } from '../lib/auth.ts'
import { APP_SCHEME } from '../lib/env.ts'

/** Web landing page for the emailed link (?token_hash) and Apple web OAuth (?code, handled by supabase-js detectSessionInUrl). */
export default function AuthCallback() {
  const nav = useNavigate()
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const th = q.get('token_hash')
    // Reuse the deep-link parser: same parameters, same checks.
    const run = th ? handleAuthUrl(`${APP_SCHEME}://auth/callback?token_hash=${encodeURIComponent(th)}&type=${encodeURIComponent(q.get('type') ?? '')}`).catch(() => false) : Promise.resolve(true)
    const t = setTimeout(() => { void run.then(() => nav('/games', { replace: true })) }, 800)
    return () => clearTimeout(t)
  }, [nav])
  return <main className="screen"><p className="fine" role="status">Signing you in…</p></main>
}
