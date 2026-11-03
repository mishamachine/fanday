// Pure logic for the `go` redirect (no Deno APIs, so scripts/test-go.mjs can import it).
export const SLOTS = ['watch', 'tickets', 'sponsor'] as const
export type Slot = (typeof SLOTS)[number]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Accepts .../go/{game}/{slot} (any prefix, such as /functions/v1). Anything else is null. */
export function parseGoPath(pathname: string): { gameId: string; slot: Slot } | null {
  const parts = pathname.split('/').filter(Boolean)
  const i = parts.lastIndexOf('go')
  if (i < 0 || parts.length !== i + 3) return null
  const [gameId, slot] = [parts[i + 1], parts[i + 2]]
  if (!UUID.test(gameId) || !(SLOTS as readonly string[]).includes(slot)) return null
  return { gameId: gameId.toLowerCase(), slot: slot as Slot }
}

export interface GameLinks {
  watch_url: string | null
  tickets_url: string | null
  sponsor_url: string | null
  sponsor?: { url: string | null } | null // joined sponsors row, used when the game has no sponsor_url of its own
}

/**
 * The ONLY place a destination comes from: a URL stored on the game row (or its sponsor row). The request never
 * supplies a URL, so this is not an open redirect. https only; UTM tags added; the stored URL keeps any affiliate tag.
 */
export function resolveTarget(row: GameLinks | null, slot: Slot): string | null {
  if (!row) return null
  const stored = slot === 'watch' ? row.watch_url : slot === 'tickets' ? row.tickets_url : row.sponsor_url ?? row.sponsor?.url ?? null
  if (!stored) return null
  let u: URL
  try { u = new URL(stored) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password) return null
  u.searchParams.set('utm_source', 'fanday')
  u.searchParams.set('utm_medium', 'calendar')
  u.searchParams.set('utm_campaign', slot)
  return u.toString()
}
