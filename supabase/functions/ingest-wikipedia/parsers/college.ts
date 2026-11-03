// {{CFB schedule entry}} and {{CBB schedule entry}}: team-season pages for NCAA football and basketball.
// The page subject (ctx.subject) is home unless `away = y`; neutral-site games keep the subject as home.

import type { ParsedGame, ParseContext, TeamRef } from '../types.ts';
import { cleanText, cleanWikitext, findTemplates, type Template } from '../wikitext.ts';
import { isoDate, parseDate, parseTime, resolveZone, toKickoff, type Zone } from '../time.ts';
import { broadcastOrNull, statusFromScore, textOrNull } from './common.ts';

const yes = (v: string | undefined) => /^\s*(?:y|yes|true|1)\b/i.test(v ?? '');

function section(text: string, pos: number): string | null {
  // CBB tables separate groups with a header row: !colspan=9 ...| Exhibition
  const re = /^!\s*colspan.*\|\s*([^|\n]+)$/gm;
  let found: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && m.index < pos) found = cleanText(m[1]);
  return found;
}

function entries(text: string, names: string[], ctx: ParseContext, fallback: Zone | null): ParsedGame[] {
  const subject: TeamRef = ctx.subject ?? { name: '', page: null };
  const out: ParsedGame[] = [];
  const list: Template[] = findTemplates(text, names);
  for (const t of list) {
    const p = t.named;
    const date = parseDate(p['date'], ctx);
    const opp = cleanText(p['opponent']);
    if (!date || !opp || /^(?:tba|tbd|tbc)$/i.test(opp)) continue;
    const opponent: TeamRef = { name: opp, page: null };
    const away = yes(p['away']);
    const { kickoffAt, timeTbc } = toKickoff(date, parseTime(p['time']), fallback);
    out.push({
      home: away ? opponent : subject,
      away: away ? subject : opponent,
      date: isoDate(date), kickoffAt, timeTbc,
      status: statusFromScore(p['score']),
      venue: textOrNull(p['site_stadium']),
      broadcast: broadcastOrNull(p['tv']),
      section: section(text, t.start),
    });
  }
  return out;
}

export function parseCfb(wikitext: string, ctx: ParseContext = {}): ParsedGame[] {
  const text = cleanWikitext(wikitext);
  const tzParam = findTemplates(text, ['cfbschedule'])[0]?.named['timezone'];
  const zone = resolveZone(cleanText(tzParam)) ?? (ctx.tz ? { iana: ctx.tz } : { iana: 'America/New_York' });
  return entries(text, ['cfbscheduleentry'], { ...ctx, crossYear: true }, zone);
}

export function parseCbb(wikitext: string, ctx: ParseContext = {}): ParsedGame[] {
  const text = cleanWikitext(wikitext);
  const tzParam = findTemplates(text, ['cbbscheduleend', 'cbbschedulestart'])
    .map((t) => t.named['timezone']).find(Boolean);
  const zone = resolveZone(cleanText(tzParam).replace(/\s*time$/i, '')) ?? (ctx.tz ? { iana: ctx.tz } : { iana: 'America/New_York' });
  return entries(text, ['cbbscheduleentry'], ctx, zone);
}
