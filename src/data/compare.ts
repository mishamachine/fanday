export function compareGames(a: { kickoffAt: string | null; gameDate: string }, b: { kickoffAt: string | null; gameDate: string }) {
  const ka = a.kickoffAt ?? `${a.gameDate}T00:00:00Z`
  const kb = b.kickoffAt ?? `${b.gameDate}T00:00:00Z`
  return ka < kb ? -1 : ka > kb ? 1 : 0
}
