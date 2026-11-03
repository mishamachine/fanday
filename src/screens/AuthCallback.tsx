import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/** Web magic-link / OAuth landing page. supabase-js (detectSessionInUrl) exchanges the code; we just move on. */
export default function AuthCallback() {
  const nav = useNavigate()
  useEffect(() => { const t = setTimeout(() => nav('/games', { replace: true }), 800); return () => clearTimeout(t) }, [nav])
  return <main className="screen"><p className="fine" role="status">Signing you in…</p></main>
}
