// MLB {{Game log section start}} and WNBA {{WNBA game log section}} rows: "# | Date | Opponent | Score ...".
// These logs carry no start time and no venue, so every game is date-only (time TBC) until Wikipedia adds times.
// A doubleheader (same teams, same day) collapses to one game: the key has no game number.

import type { ParsedGame, ParseContext } from '../types.ts';
import { cleanText, cleanWikitext, findHeadings, sectionAt } from '../wikitext.ts';
import { isoDate, parseDate } from '../time.ts';
import { seasonPage } from './common.ts';
import { rowCells } from './table.ts';

export function parseGameLog(wikitext: string, ctx: ParseContext = {}): ParsedGame[] {
  const text = cleanWikitext(wikitext);
  const headings = findHeadings(text);
  const subject = ctx.subject ?? { name: '', page: null };
  const out: ParsedGame[] = [];
  const re = /^\|-[^\n]*\n([\s\S]*?)(?=^\|-|^\{\{|^\|\})/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const cells = rowCells(m[1]);
    if (cells.length < 4 || !/^\d+$/.test(cleanText(cells[0]))) continue;
    const date = parseDate(cells[1], ctx);
    const oppText = cleanText(cells[2]);
    const name = oppText.replace(/^(?:@|at|vs\.?)\s*/i, '').trim();
    if (!date || !name) continue;
    const away = /^(?:@|at\b)/i.test(oppText);
    const opponent = { name: seasonPage(cells[2]) ?? name, page: seasonPage(cells[2]) };
    const score = cleanText(cells[3]);
    out.push({
      home: away ? opponent : subject, away: away ? subject : opponent,
      date: isoDate(date), kickoffAt: null, timeTbc: true,
      status: /postpon|ppd/i.test(score) ? 'postponed' : /\d+\s*[–-]\s*\d+/.test(score) ? 'final' : 'scheduled',
      venue: null, broadcast: null,
      section: sectionAt(headings, m.index),
    });
  }
  return out;
}
