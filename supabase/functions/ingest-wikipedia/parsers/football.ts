// {{Football box}}, {{Football box collapsible}}, {{footballbox ...}} and {{#invoke:Football box|main}}.
// Used by EPL, La Liga, Serie A, Bundesliga, Ligue 1, UCL and MLS pages.

import type { ParsedGame, ParseContext, TeamRef } from '../types.ts';
import { cleanWikitext, findHeadings, findTemplates, linkTarget, cleanText, sectionAt } from '../wikitext.ts';
import { isoDate, parseDate, parseTime, toKickoff } from '../time.ts';
import { broadcastOrNull, statusFromScore, textOrNull } from './common.ts';

const NAMES = ['footballbox', 'footballboxcollapsible'];

function team(raw: string | undefined): TeamRef | null {
  const name = cleanText(raw);
  if (!name) return null;
  return { name, page: linkTarget(raw) };
}

function fallbackZone(ctx: ParseContext, home: TeamRef) {
  const tz = ctx.zoneFromHome ? ctx.homeTz?.(home) ?? null : ctx.tz ?? null;
  return tz ? { iana: tz } : null;
}

export function parseFootball(wikitext: string, ctx: ParseContext = {}): ParsedGame[] {
  const text = cleanWikitext(wikitext);
  const headings = findHeadings(text);
  const out: ParsedGame[] = [];
  for (const t of findTemplates(text, NAMES)) {
    const p = t.named;
    const date = parseDate(p['date'], ctx);
    const home = team(p['team1']);
    const away = team(p['team2']);
    if (!date || !home || !away) continue;
    const { kickoffAt, timeTbc } = toKickoff(date, parseTime(p['time']), fallbackZone(ctx, home));
    out.push({
      home, away, date: isoDate(date), kickoffAt, timeTbc,
      status: statusFromScore(p['score']),
      venue: textOrNull(p['stadium']),
      broadcast: broadcastOrNull(p['tv'] ?? p['broadcast']),
      section: sectionAt(headings, t.start),
    });
  }
  return out;
}
