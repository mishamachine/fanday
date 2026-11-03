import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

export function LogoMark() {
  return (
    <svg viewBox="0 0 96 96" role="img" aria-label="Fanday app icon">
      <rect width="96" height="96" rx="22" fill="#0F5E5A" />
      <rect x="20" y="22" width="56" height="54" rx="8" fill="#FFFFFF" />
      <path d="M20 30a8 8 0 0 1 8-8h40a8 8 0 0 1 8 8v8H20z" fill="#1F3A5F" />
      <g fill="#0F5E5A" opacity=".35"><circle cx="33" cy="49" r="3.6" /><circle cx="48" cy="49" r="3.6" /><circle cx="63" cy="49" r="3.6" /><circle cx="33" cy="64" r="3.6" /><circle cx="63" cy="64" r="3.6" /></g>
      <rect x="40.5" y="56.5" width="15" height="15" rx="4" fill="#1F3A5F" />
    </svg>
  )
}

/** Neutral text badge: abbreviation on a teal or navy tile. Never a logo. */
export function TeamBadge({ short, id }: { short: string; id: string }) {
  const navy = Array.from(id).reduce((n, c) => n + c.charCodeAt(0), 0) % 2 === 1
  return <span className={`badge${navy ? ' navy' : ''}`} aria-hidden="true">{short}</span>
}

export function TopBar({ back, title, right }: { back?: string; title?: string; right?: ReactNode }) {
  return (
    <div className="top">
      {back ? <Link className="link" to={back}>Back</Link> : <span />}
      {title && <span className="fine">{title}</span>}
      {right ?? <span />}
    </div>
  )
}
