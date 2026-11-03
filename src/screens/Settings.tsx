import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/ui.tsx'
import { useStore } from '../store/useStore.ts'
import { deleteAccount, isAnonymous, signInWithApple, signInWithEmail, signInWithOAuth, signOut } from '../lib/auth.ts'
import { isEmail } from '../lib/authUtil.ts'
import { supabase } from '../lib/supabase.ts'
import { calendar } from '../calendar/index.ts'
import { DATA_CREDIT } from '../calendar/eventContent.ts'
import { PRIVACY_LINE } from '../lib/env.ts'

export default function Settings() {
  const nav = useNavigate()
  const { user, changeAlerts, setChangeAlerts, calendarId, reset } = useStore()
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [promo, setPromo] = useState(false)
  const signedIn = !!user && !isAnonymous(user)

  const run = (fn: () => Promise<unknown>, ok = '') => async () => {
    setError(''); setMsg('')
    try { await fn(); setMsg(ok) } catch (e) { setError((e as Error).message || 'Something went wrong.') }
  }
  async function setPromoOptIn(v: boolean) {
    setPromo(v)
    if (user && supabase) await supabase.from('profiles').update({ promo_push_opt_in: v }).eq('user_id', user.id)
  }
  const doDelete = run(async () => {
    await deleteAccount(user)
    if (calendarId) await calendar.deleteCalendar(calendarId)
    reset()
    nav('/', { replace: true })
  })

  return (
    <main className="screen">
      <TopBar back="/games" />
      <h1>Settings</h1>
      {error && <p className="err" role="alert">{error}</p>}
      {msg && <p className="fine" role="status">{msg}</p>}

      <section className="card" aria-label="Account">
        <h2>Account</h2>
        {signedIn ? (
          <>
            <p>Signed in{user?.email ? ` as ${user.email}` : ''}.</p>
            <button className="btn alt" onClick={run(async () => { await signOut(); reset(); nav('/', { replace: true }) })}>Sign out</button>
          </>
        ) : (
          <>
            <p>Optional. Sign in to keep your teams on a new phone. Your teams stay with you either way.</p>
            <button className="btn" onClick={run(signInWithApple)}>Continue with Apple</button>
            <button className="btn alt" onClick={run(() => signInWithOAuth('google'))}>Continue with Google</button>
            <input className="field" type="email" inputMode="email" autoComplete="email" aria-label="Email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn alt" disabled={!isEmail(email)} onClick={run(() => signInWithEmail(email), 'Check your email for the sign-in link.')}>Email me a sign-in link</button>
          </>
        )}
      </section>

      <section className="card" aria-label="Notifications">
        <h2>Notifications</h2>
        <label className="toggle"><span>Alert me when a kickoff moves</span>
          <input type="checkbox" checked={changeAlerts} onChange={(e) => setChangeAlerts(e.target.checked)} /></label>
        <label className="toggle"><span>Sponsor messages (off by default)</span>
          <input type="checkbox" checked={promo} onChange={(e) => void setPromoOptIn(e.target.checked)} /></label>
        <p>Alerts arrive with the push update. These switches save your choice now.</p>
      </section>

      <section className="card" aria-label="Delete account">
        <h2>Delete account</h2>
        {confirmDelete ? (
          <>
            <p>This removes your teams, your account and the Fanday calendar on this phone. It can't be undone.</p>
            <button className="btn danger" onClick={doDelete}>Yes, delete everything</button>
            <button className="btn alt" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </>
        ) : (
          <>
            <p>Removes your teams and account data.</p>
            <button className="btn danger" onClick={() => setConfirmDelete(true)}>Delete account</button>
          </>
        )}
      </section>

      <p className="fine">{PRIVACY_LINE}</p>
      <p className="fine">{DATA_CREDIT}</p>
    </main>
  )
}
