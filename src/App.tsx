import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Welcome from './screens/Welcome.tsx'
import PickLeague from './screens/PickLeague.tsx'
import PickTeams from './screens/PickTeams.tsx'
import Games from './screens/Games.tsx'
import OfficialCalendar from './screens/OfficialCalendar.tsx'
import Settings from './screens/Settings.tsx'
import AuthCallback from './screens/AuthCallback.tsx'
import { useStore } from './store/useStore.ts'
import { ensureAnonymousSession, initAuthListeners } from './lib/auth.ts'

export default function App() {
  const onboarded = useStore((s) => s.onboarded)
  const setUser = useStore((s) => s.setUser)
  const pullFollows = useStore((s) => s.pullFollows)

  useEffect(() => {
    const stop = initAuthListeners((u) => { setUser(u); void pullFollows() })
    void ensureAnonymousSession().then((u) => { if (u) setUser(u) }) // first launch: anonymous session, no prompt
    return stop
  }, [setUser, pullFollows])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={onboarded ? <Navigate to="/games" replace /> : <Welcome />} />
        <Route path="/leagues" element={<PickLeague />} />
        <Route path="/leagues/:leagueId" element={<PickTeams />} />
        <Route path="/games" element={<Games />} />
        <Route path="/official/:teamId" element={<OfficialCalendar />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
