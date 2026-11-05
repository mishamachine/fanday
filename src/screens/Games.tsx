import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { data, type Game, type League, type Team } from '../data/index.ts'
import { formatTime, formatWeekday } from '../lib/time.ts'
import { useStore } from '../store/useStore.ts'
import CalendarStatus from '../calendar/CalendarStatus.tsx'

export function GameRow({ g }: { g: Game }) {
  const moved = !!g.previousKickoffAt && !g.timeTbc
  const postponed = g.status === 'postponed'
  const alert = moved || postponed
  const time = g.timeTbc || !g.kickoffAt ? 'All day' : formatTime(g.kickoffAt, g.countryCode)
  const sub = [g.broadcast ?? 'Where to watch: not listed yet', g.venue].filter(Boolean).join(' · ')
  return (
    <li className={`g${alert ? ' al' : ''}`}>
      <div className="when"><b>{formatWeekday(g.kickoffAt ?? g.gameDate)}</b><span>{time}</span></div>
      <div className="what">
        <b>{g.homeName} vs {g.awayName}</b>
        <small>{sub}</small>
        {moved && g.previousKickoffAt && <small> · was {formatTime(g.previousKickoffAt, g.countryCode)}</small>}
      </div>
      {postponed && <span className="tag mv">Postponed</span>}
      {moved && !postponed && <span className="tag mv">Moved</span>}
      {g.timeTbc && !alert && <span className="tag tbc">Time TBC</span>}
    </li>
  )
}

export default function Games() {
  const follows = useStore((s) => s.follows)
  const [games, setGames] = useState<Game[]>([])
  const [official, setOfficial] = useState<Array<{ team: Team; league: League }>>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setLoading(true); setError('')
    ;(async () => {
      try {
        const leagues = await data.listLeagues()
        const teams = (await Promise.all(leagues.map((l) => data.listTeams(l.id)))).flat().filter((t) => follows.includes(t.id))
        const officialLeagues = new Set(leagues.filter((l) => l.source === 'official_link').map((l) => l.id))
        const wiki = teams.filter((t) => !officialLeagues.has(t.leagueId)).map((t) => t.id)
        const list = await data.listGames(wiki)
        if (!live) return
        setGames(list)
        setOfficial(teams.filter((t) => officialLeagues.has(t.leagueId)).map((team) => ({ team, league: leagues.find((l) => l.id === team.leagueId)! })))
      } catch { if (live) setError('Could not load your games.') } finally { if (live) setLoading(false) }
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follows, attempt])

  return (
    <main className="screen">
      <div className="top"><Link className="link" to="/leagues">Add teams</Link><Link className="link" to="/settings">Settings</Link></div>
      <h1>Your games</h1>
      <CalendarStatus />
      {loading && <p className="fine" role="status">Loading your games…</p>}
      {error && <div className="err" role="alert">{error} <button className="link" onClick={() => setAttempt((n) => n + 1)}>Retry</button></div>}
      <ul className="list">
        {games.map((g) => <GameRow key={g.id} g={g} />)}
        {official.map(({ team, league }) => (
          <li key={team.id} className="g">
            <div className="when"><b>{league.name}</b><span>Link</span></div>
            <div className="what"><b>{team.name}</b><small>Official calendar</small></div>
            <Link className="btn btn-sm" to={`/official/${team.id}`}>Add</Link>
          </li>
        ))}
      </ul>
      {!loading && !games.length && !official.length && !error && <p className="fine">No upcoming games yet. Schedules are added as they are published.</p>}
      {follows.length > 0 && <p className="fine">Following {follows.length} team{follows.length === 1 ? '' : 's'}.</p>}
    </main>
  )
}
