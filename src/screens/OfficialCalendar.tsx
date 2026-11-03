import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Browser } from '@capacitor/browser'
import { data, type Team } from '../data/index.ts'
import { TopBar } from '../components/ui.tsx'
import { isNative, platform } from '../lib/env.ts'
import { officialCalendarTarget } from '../lib/officialCalendar.ts'

/** NBA / NHL: Wikipedia has no start times, so one tap hands the team's own calendar link to the phone. */
export default function OfficialCalendar() {
  const { teamId = '' } = useParams()
  const nav = useNavigate()
  const [team, setTeam] = useState<Team | null>(null)
  useEffect(() => {
    const leagueId = teamId.split('-')[0]
    data.listTeams(leagueId).then((ts) => setTeam(ts.find((t) => t.id === teamId) ?? null))
  }, [teamId])

  async function add() {
    if (!team?.officialCalendarUrl) return
    const url = officialCalendarTarget(team.officialCalendarUrl, platform)
    if (isNative) await Browser.open({ url }) // system browser; webcal:// hands off to the calendar app on iOS
    else window.open(url, '_blank', 'noopener')
  }

  return (
    <main className="screen">
      <TopBar back="/games" />
      <h1>{team?.name ?? 'Team'}: add the official calendar</h1>
      <section className="card"><p>The NBA and NHL don't publish start times we can read for free, so we link you to the team's own calendar. One tap adds it, and your phone keeps it current.</p></section>
      <section className="card"><h2>{team?.name}</h2><p>Official team calendar · opens in your calendar app</p></section>
      <div className="sp" />
      <button className="btn" onClick={add} disabled={!team?.officialCalendarUrl}>Add to my calendar</button>
      {team && !team.officialCalendarUrl && <p className="fine">This team's calendar link is not available yet.</p>}
      <p className="fine">No paid links on these games.</p>
      <button className="link" onClick={() => nav('/games')}>Not now</button>
    </main>
  )
}
