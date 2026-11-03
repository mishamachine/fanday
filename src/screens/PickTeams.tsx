import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { data, type League, type Team } from '../data/index.ts'
import { TeamBadge, TopBar } from '../components/ui.tsx'
import { useStore } from '../store/useStore.ts'
import { PRIVACY_LINE } from '../lib/env.ts'
import { isEmail } from '../lib/authUtil.ts'
import { signInWithEmail } from '../lib/auth.ts'
import { isAnonymous } from '../lib/auth.ts'

export default function PickTeams() {
  const { leagueId = '' } = useParams()
  const nav = useNavigate()
  const { follows, toggleTeam, finishOnboarding, user } = useStore()
  const [league, setLeague] = useState<League | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [email, setEmail] = useState('')
  const [emailState, setEmailState] = useState<'idle' | 'sent' | 'skipped'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    data.listLeagues().then((ls) => setLeague(ls.find((l) => l.id === leagueId) ?? null))
    data.listTeams(leagueId).then(setTeams).catch(() => setError('Could not load teams.'))
  }, [leagueId])

  const count = teams.filter((t) => follows.includes(t.id)).length // ticked on this screen only
  const canSave = !user || isAnonymous(user)
  async function sendLink() {
    setError('')
    try { await signInWithEmail(email); setEmailState('sent') } catch (e) { setError((e as Error).message) }
  }
  function done() { finishOnboarding(); nav('/games') }

  return (
    <main className="screen">
      <TopBar back="/leagues" />
      <h1>{league?.name ?? 'League'}: pick your teams</h1>
      {league && !league.inSeason && <p className="fine">Off-season. Games are added automatically when the schedule is published.</p>}
      {error && <p className="err" role="alert">{error}</p>}
      <ul className="list">
        {teams.map((t) => {
          const on = follows.includes(t.id)
          return (
            <li key={t.id}>
              <button className="row" role="checkbox" aria-checked={on} onClick={() => toggleTeam(t.id)}>
                <span className={`chk${on ? ' on' : ''}`} aria-hidden="true">{on ? '✓' : ''}</span>
                <TeamBadge short={t.shortName} id={t.id} />
                <b>{t.name}</b>
              </button>
            </li>
          )
        })}
      </ul>
      {canSave && emailState !== 'skipped' && (
        <section className="card" aria-label="Save your teams">
          <h2>Save your teams across devices (optional)</h2>
          {emailState === 'sent' ? <p>Check your email for the sign-in link.</p> : (
            <>
              <p>Add an email to restore your teams on a new phone.</p>
              <input className="field" type="email" inputMode="email" autoComplete="email" aria-label="Email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <div className="top">
                <span className="fine narrow">Never sold. No marketing mail unless you opt in.</span>
                <span>
                  <button className="link" onClick={() => setEmailState('skipped')}>Skip</button>
                  <button className="btn btn-sm" disabled={!isEmail(email)} onClick={sendLink}>Send link</button>
                </span>
              </div>
            </>
          )}
        </section>
      )}
      <div className="sp" />
      <button className="btn" disabled={!count && !follows.length} onClick={done}>{count ? `Add ${count} team${count === 1 ? '' : 's'} to my calendar` : follows.length ? 'Done' : 'Pick a team to continue'}</button>
      <p className="fine">{PRIVACY_LINE}</p>
    </main>
  )
}
