import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { data, type League } from '../data/index.ts'
import { TopBar } from '../components/ui.tsx'
import { useStore } from '../store/useStore.ts'

export default function PickLeague() {
  const [leagues, setLeagues] = useState<League[]>([])
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const onboarded = useStore((s) => s.onboarded)
  useEffect(() => { data.listLeagues().then(setLeagues).catch(() => setError('Could not load leagues. Check your connection.')) }, [])
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return n ? leagues.filter((l) => `${l.name} ${l.country}`.toLowerCase().includes(n)) : leagues
  }, [leagues, q])
  return (
    <main className="screen">
      <TopBar back={onboarded ? '/games' : '/'} />
      <h1>Pick a league</h1>
      <input className="search" type="search" aria-label="Search leagues" placeholder={`Search ${leagues.length || ''} leagues`.replace('  ', ' ')} value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <p className="err" role="alert">{error}</p>}
      <ul className="list">
        {shown.map((l) => (
          <li key={l.id}>
            <Link className="row" to={`/leagues/${l.id}`}>
              <span className="chip">{l.country}</span>
              <b>{l.name}</b>
              {!l.inSeason && <span className="tag tbc">Schedule coming</span>}
              <span className="chev" aria-hidden="true">›</span>
            </Link>
          </li>
        ))}
        {!shown.length && !error && <li className="fine">No league matches "{q}".</li>}
      </ul>
    </main>
  )
}
