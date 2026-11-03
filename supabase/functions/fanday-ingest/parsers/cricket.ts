// {{Single-innings cricket match}} rows from the IPL season page. Times are IST (UTC+5:30); "(H)" marks the home team.
// Here IST is India, unlike the football parsers where it is Irish time.

import type { ParsedGame, ParseContext, TeamRef } from '../types.ts';
import { cleanText, cleanWikitext, findHeadings, findTemplates, linkTarget, sectionAt } from '../wikitext.ts';
import { isoDate, parseDate, parseTime, toKickoff } from '../time.ts';
import { textOrNull } from './common.ts';

function team(raw: string | undefined): { ref: TeamRef; home: boolean } | null {
  const name = cleanText(raw).replace(/\s*\(H\)\s*$/i, '').trim();
  if (!name) return null;
  return { ref: { name, page: linkTarget(raw) }, home: /\(H\)\s*$/i.test(cleanText(raw)) };
}

export function parseCricket(wikitext: string, ctx: ParseContext = {}): ParsedGame[] {
  const text = cleanWikitext(wikitext);
  const headings = findHeadings(text);
  const zone = { iana: ctx.tz ?? 'Asia/Kolkata' };
  const out: ParsedGame[] = [];
  for (const t of findTemplates(text, ['singleinningscricketmatch'])) {
    const p = t.named;
    const date = parseDate(p['date'], ctx);
    const a = team(p['team1']);
    const b = team(p['team2']);
    if (!date || !a || !b) continue;
    const [home, away] = b.home && !a.home ? [b.ref, a.ref] : [a.ref, b.ref];
    const { kickoffAt, timeTbc } = toKickoff(date, parseTime((p['time'] ?? '').replace(/\bIST\b/g, 'UTC+5:30')), zone);
    const result = cleanText(p['result']);
    out.push({
      home, away, date: isoDate(date), kickoffAt, timeTbc,
      status: /postpon/i.test(result) ? 'postponed' : /abandon|cancel/i.test(result) ? 'cancelled' : result ? 'final' : 'scheduled',
      venue: textOrNull(p['venue']), broadcast: null,
      section: sectionAt(headings, t.start),
    });
  }
  return out;
}
