// NRL "{year} NRL season results" page: one table per round with Home | Score | Away | Day & time | Venue | Referee | Attendance.
// A venue cell with rowspan covers the next row too (two games at one ground), so the venue is carried down.

import type { ParsedGame, ParseContext } from '../types.ts';
import { cleanText, cleanWikitext, findHeadings, linkTarget, sectionAt } from '../wikitext.ts';
import { isoDate, parseDate, parseTime, toKickoff, type YMD } from '../time.ts';
import { textOrNull, venueZone } from './common.ts';
import { tableCells } from './table.ts';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Rounds after the first give only a weekday ("Thursday, 7:00 pm"); the date comes from the round's "March 12-15" line. */
function dateFromRound(when: string, roundStart: YMD | null): YMD | null {
  const wd = DAYS.indexOf(cleanText(when).slice(0, 3).toLowerCase());
  if (wd < 0 || !roundStart) return null;
  const t = new Date(Date.UTC(roundStart.y, roundStart.m - 1, roundStart.d));
  for (let i = 0; i < 7; i++, t.setUTCDate(t.getUTCDate() + 1)) {
    if (t.getUTCDay() === wd) return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  return null;
}

export function parseRugby(wikitext: string, ctx: ParseContext = {}): ParsedGame[] {
  const text = cleanWikitext(wikitext);
  const headings = findHeadings(text);
  const out: ParsedGame[] = [];
  let offset = 0;
  for (const block of text.split(/^\{\|/m).slice(1)) {
    offset = text.indexOf(block, offset);
    if (!/!\s*(?:rowspan="?\d+"?\s*\|)?\s*Home\b/i.test(block)) continue;
    const roundLine = [...text.slice(Math.max(0, offset - 400), offset).matchAll(/'''([A-Za-z]+ \d{1,2})(?:\s*[\u2013-]\s*(?:[A-Za-z]+ )?\d{1,2})?'''/g)].pop();
    const roundStart = roundLine ? parseDate(roundLine[1], ctx) : null;
    let carry: { venue: string; left: number } | null = null;
    for (const row of block.split(/^\|-[^\n]*$/m).slice(1)) {
      const cells = tableCells(row);
      if (cells.length < 4) continue;
      const [home, score, away, when] = cells.map((c) => c.text);
      const homePage = linkTarget(home);
      const awayPage = linkTarget(away);
      const date = parseDate(when, ctx) ?? dateFromRound(when, roundStart);
      if (!homePage || !awayPage || !date) continue;
      let venueRaw: string | undefined;
      if (carry && carry.left > 0) { venueRaw = carry.venue; carry.left--; }
      else {
        venueRaw = cells[4]?.text;
        const span = Number(/rowspan="?(\d+)/i.exec(cells[4]?.attrs ?? '')?.[1] ?? 1);
        carry = venueRaw && span > 1 ? { venue: venueRaw, left: span - 1 } : null;
      }
      const venue = textOrNull(venueRaw);
      const time = parseTime(cleanText(when).replace(/^[^,]*,\s*/, ''));
      const { kickoffAt, timeTbc } = toKickoff(date, time, venueZone(venue ?? ''));
      const sc = cleanText(score);
      out.push({
        home: { name: cleanText(home), page: homePage }, away: { name: cleanText(away), page: awayPage },
        date: isoDate(date), kickoffAt, timeTbc,
        status: /postpon/i.test(sc) ? 'postponed' : /\d+\s*[–-]\s*\d+/.test(sc) ? 'final' : 'scheduled',
        venue, broadcast: null,
        section: sectionAt(headings, offset),
      });
    }
  }
  return out;
}
