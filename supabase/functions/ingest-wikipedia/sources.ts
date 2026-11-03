// Which Wikipedia pages feed which league, and how to read them. `slug` is leagues.id.
// NBA and NHL are deliberately missing: they use official calendar links (build-plan.md).

import type { ParseContext, ParserKind } from './types.ts';

export interface LeagueSource {
  slug: string;
  kind: ParserKind;
  /** 'team': one season page per team (teams.wiki_page). 'league': fixed page(s) for the whole league. */
  mode: 'team' | 'league';
  /** MLS: no label and no league zone; take the zone from the home team (teams.tz). */
  zoneFromHome?: boolean;
  /** Zone for times with no label. Team pages that label their times (CT, EDT, BST) override it. */
  tz?: string;
  title: (season: string, teamPage?: string) => string[];
  /** Map a game's section heading to a league slug. A game whose section matches nothing is dropped. */
  sectionMap?: Array<[RegExp, string]>;
  skipSections?: RegExp;
}

/** Wikipedia titles use an en dash: "2026-27" becomes "2026\u201327". */
const dash = (season: string) => season.replace(/^(\d{4})-(\d{2})$/, '$1\u2013$2');
const teamSeason = (suffix: string) => (season: string, page?: string) => (page ? [`${dash(season)} ${page}${suffix}`] : []);

export const LEAGUE_SOURCES: LeagueSource[] = [
  { slug: 'epl', kind: 'football', mode: 'team', tz: 'Europe/London', title: teamSeason(' season'), sectionMap: [[/^Premier League$/i, 'epl']] },
  { slug: 'laliga', kind: 'football', mode: 'team', tz: 'Europe/Madrid', title: teamSeason(' season'), sectionMap: [[/^La Liga$/i, 'laliga']] },
  { slug: 'seriea', kind: 'football', mode: 'team', tz: 'Europe/Rome', title: teamSeason(' season'), sectionMap: [[/^Serie A$/i, 'seriea']] },
  { slug: 'bundesliga', kind: 'football', mode: 'team', tz: 'Europe/Berlin', title: teamSeason(' season'), sectionMap: [[/^Bundesliga$/i, 'bundesliga']] },
  { slug: 'ligue1', kind: 'football', mode: 'team', tz: 'Europe/Paris', title: teamSeason(' season'), sectionMap: [[/^Ligue 1$/i, 'ligue1']] },
  { slug: 'mls', kind: 'football', mode: 'team', zoneFromHome: true, title: teamSeason(' season'), sectionMap: [[/^Major League Soccer/i, 'mls']] },
  { slug: 'ligamx', kind: 'football', mode: 'team', tz: 'America/Mexico_City', title: teamSeason(' season'), sectionMap: [[/^(?:Apertura|Clausura)\b/i, 'ligamx']] },
  { slug: 'brasileirao', kind: 'football', mode: 'team', tz: 'America/Sao_Paulo', title: teamSeason(' season'), sectionMap: [[/^Campeonato Brasileiro/i, 'brasileirao']] },
  // UEFA times are CET/CEST unless a UTC offset says otherwise.
  { slug: 'ucl', kind: 'football', mode: 'league', tz: 'Europe/Paris', title: (s) => [`${dash(s)} UEFA Champions League league phase`] },
  { slug: 'nfl', kind: 'nfl', mode: 'team', tz: 'America/New_York', title: teamSeason(' season'), sectionMap: [[/^(?:Schedule|Regular season)$/i, 'nfl']] },
  { slug: 'ncaaf', kind: 'cfb', mode: 'team', tz: 'America/New_York', title: teamSeason(' team') },
  { slug: 'ncaab', kind: 'cbb', mode: 'team', tz: 'America/New_York', title: teamSeason(' team'), skipSections: /^exhibition/i },
  // Off-season leagues: formats taken from the 2026 pages; 2027 pages publish later. MLB/WNBA logs have dates only.
  { slug: 'mlb', kind: 'gamelog', mode: 'team', title: teamSeason(' season') },
  { slug: 'wnba', kind: 'gamelog', mode: 'team', title: teamSeason(' season'), skipSections: /^preseason/i },
  { slug: 'ipl', kind: 'cricket', mode: 'league', tz: 'Asia/Kolkata', title: (s) => [`${s} Indian Premier League`] },
  { slug: 'nrl', kind: 'rugby', mode: 'league', title: (s) => [`${s} NRL season results`] },
  { slug: 'afl', kind: 'afl', mode: 'league', title: (s) => [`${dash(s)} AFL season`] },
];

export const sourceFor = (slug: string): LeagueSource | undefined => LEAGUE_SOURCES.find((s) => s.slug === slug);

/** League slug for a parsed game, or null when the game belongs to a competition we do not carry. */
export function leagueForSection(src: LeagueSource, section: string | null): string | null {
  if (src.skipSections && section && src.skipSections.test(section)) return null;
  if (!src.sectionMap) return src.slug;
  for (const [re, slug] of src.sectionMap) if (re.test(section ?? '')) return slug;
  return null;
}

/** Season string such as "2026-27", "2026–27" or "2026" to the parse context fields. */
export function seasonContext(season: string): Pick<ParseContext, 'year' | 'crossYear'> {
  const year = Number(/\d{4}/.exec(season)?.[0]);
  return { year: Number.isFinite(year) ? year : undefined, crossYear: /\d{4}\s*[–-]\s*\d{2}/.test(season) || undefined };
}
