import type { League } from './types.ts'

// Every v1 league (README, 2026-11-02). Mirrors supabase/seed.sql.
// NBA and NHL use official team calendar links (Wikipedia has no start times for them).
// MLB, WNBA, IPL and NRL are off-season: pickable now, games arrive when the schedule is published.
const L = (id: string, name: string, country: string, countryCode: string, sport: string,
  inSeason = true, source: League['source'] = 'wikipedia'): League =>
  ({ id, name, country, countryCode, sport, source, inSeason })

export const LEAGUES: League[] = [
  L('epl', 'Premier League', 'England', 'GB', 'soccer'),
  L('nfl', 'NFL', 'USA', 'US', 'american_football'),
  L('nba', 'NBA', 'USA', 'US', 'basketball', true, 'official_link'),
  L('wnba', 'WNBA', 'USA', 'US', 'basketball', false),
  L('mlb', 'MLB', 'USA', 'US', 'baseball', false),
  L('nhl', 'NHL', 'USA', 'US', 'hockey', true, 'official_link'),
  L('mls', 'MLS', 'USA', 'US', 'soccer'),
  L('ncaaf', 'NCAA Football', 'USA', 'US', 'american_football'),
  L('ncaab', 'NCAA Basketball', 'USA', 'US', 'basketball'),
  L('laliga', 'La Liga', 'Spain', 'ES', 'soccer'),
  L('seriea', 'Serie A', 'Italy', 'IT', 'soccer'),
  L('bundesliga', 'Bundesliga', 'Germany', 'DE', 'soccer'),
  L('ligue1', 'Ligue 1', 'France', 'FR', 'soccer'),
  L('ucl', 'Champions League', 'Europe', 'EU', 'soccer'),
  L('ligamx', 'Liga MX', 'Mexico', 'MX', 'soccer'),
  L('brasileirao', 'Brasileirao Serie A', 'Brazil', 'BR', 'soccer'),
  L('ipl', 'IPL', 'India', 'IN', 'cricket', false),
  L('afl', 'AFL', 'Australia', 'AU', 'aussie_rules'),
  L('nrl', 'NRL', 'Australia', 'AU', 'rugby_league', false),
]
