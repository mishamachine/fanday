import type { DataSource } from './types.ts'
import { LEAGUES } from './leagues.ts'
import { compareGames } from './compare.ts'
import { MOCK_TEAMS, mockGames } from './mockData.ts'

/** Built-in mock data. Swapped for supabaseSource once the ingest has filled the tables. */
export const mockSource: DataSource = {
  async listLeagues() { return LEAGUES },
  async listTeams(leagueId) { return MOCK_TEAMS.filter((t) => t.leagueId === leagueId) },
  async listGames(teamIds, now = new Date(), aheadDays) {
    const set = new Set(teamIds)
    const last = aheadDays === undefined ? '9999-12-31' : new Date(now.getTime() + aheadDays * 86_400_000).toISOString().slice(0, 10)
    return mockGames(now)
      .filter((g) => (set.has(g.homeTeamId) || set.has(g.awayTeamId)) && g.gameDate <= last)
      .sort(compareGames)
  },
}

