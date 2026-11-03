// NFL team-season schedule wikitable: Week | Date | Time (CT) | Opponent | Result | Record | Venue | TV | Recap.
// Columns are located by header text, so a reordered or trimmed table still parses.

import type { ParsedGame, ParseContext } from '../types.ts';
import { cleanText, cleanWikitext, findHeadings, sectionAt } from '../wikitext.ts';
import { rowCells } from './table.ts';
import { isoDate, parseDate, parseTime, resolveZone, toKickoff } from '../time.ts';
import { broadcastOrNull, seasonPage, textOrNull } from './common.ts';

export function parseNfl(wikitext: string, ctx: ParseContext = {}): ParsedGame[] {
  const text = cleanWikitext(wikitext);
  const out: ParsedGame[] = [];
  const subject = ctx.subject ?? { name: '', page: null };
  const dctx: ParseContext = { ...ctx, crossYear: true };
  const headings = findHeadings(text);
  let offset = 0;
  for (const block of text.split(/^\{\|/m).slice(1)) {
    offset = text.indexOf(block, offset);
    const rows = block.split(/^\|-[^\n]*$/m);
    const header = rowCells(rows[0]).map((c) => cleanText(c));
    const col = (re: RegExp) => header.findIndex((h) => re.test(h));
    const iDate = col(/^date/i), iTime = col(/^time/i), iOpp = col(/^opponent/i), iVenue = col(/^(?:venue|stadium|location)/i);
    if (iDate < 0 || iOpp < 0 || iVenue < 0) continue;
    const iTv = col(/^(?:tv|network|broadcast)/i), iRes = col(/^result/i);
    const zoneLabel = /\(([A-Za-z]{2,4})\)/.exec(header[iTime] ?? '')?.[1];
    const zone = resolveZone(zoneLabel) ?? (ctx.tz ? { iana: ctx.tz } : { iana: 'America/New_York' });
    for (const row of rows.slice(1)) {
      const cells = rowCells(row);
      if (cells.length < header.length || /\bbye\b/i.test(cleanText(cells[iOpp]))) continue;
      const date = parseDate(cells[iDate], dctx);
      const oppText = cleanText(cells[iOpp]);
      const m = /^(at|vs\.?|@)\s+(.*)$/i.exec(oppText);
      const name = (m ? m[2] : oppText).trim();
      if (!date || !name) continue;
      const away = !!m && /^(?:at|@)$/i.test(m[1]);
      const opponent = { name, page: seasonPage(cells[iOpp]) };
      const { kickoffAt, timeTbc } = toKickoff(date, parseTime(iTime >= 0 ? cells[iTime] : ''), zone);
      out.push({
        home: away ? opponent : subject, away: away ? subject : opponent,
        date: isoDate(date), kickoffAt, timeTbc,
        status: iRes >= 0 && /\d/.test(cleanText(cells[iRes])) ? 'final' : 'scheduled',
        venue: textOrNull(cells[iVenue]),
        broadcast: iTv >= 0 ? broadcastOrNull(cells[iTv]) : null,
        section: sectionAt(headings, offset),
      });
    }
  }
  return out;
}
