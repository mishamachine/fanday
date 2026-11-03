import { useNavigate } from 'react-router-dom'
import { LogoMark } from '../components/ui.tsx'
import { PRIVACY_LINE } from '../lib/env.ts'

export default function Welcome() {
  const nav = useNavigate()
  return (
    <main className="screen splash">
      <div className="sp" />
      <LogoMark />
      <h1>Fanday</h1>
      <p className="tl">Your games. Your calendar. That's it.</p>
      <div className="sp" />
      <button className="btn" onClick={() => nav('/leagues')}>Get started</button>
      <p className="fine">{PRIVACY_LINE}</p>
    </main>
  )
}
