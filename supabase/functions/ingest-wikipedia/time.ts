// Date and time parsing plus local-time to UTC conversion.
// Pure TypeScript: uses only ECMAScript Date and Intl, which Deno and Node both ship.

import { cleanText } from './wikitext.ts';
import type { ParseContext } from './types.ts';

/** A zone is either a fixed UTC offset (from a label like CEST) or an IANA zone with DST rules. */
export type Zone = { offsetMin: number } | { iana: string };

// Fixed-offset abbreviations as Wikipedia football/sports pages use them.
// IST is Irish Standard Time (+1): in this context it is never India. CST is US Central.
const FIXED: Record<string, number> = {
  UTC: 0, GMT: 0, WET: 0, BST: 60, WEST: 60, IST: 60, CET: 60, CEST: 120, EET: 120, EEST: 180, MSK: 180,
  TRT: 180, GST: 240,
  EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420,
  AKST: -540, AKDT: -480, HST: -600,
  AWST: 480, ACST: 570, ACDT: 630, AEST: 600, AEDT: 660, NZST: 720, NZDT: 780,
  HKT: 480, SGT: 480, KST: 540, JST: 540, CAT: 120, SAST: 120, WAT: 60, BRT: -180, ART: -180,
};

// Generic labels meaning "the local zone with DST rules".
const IANA_LABELS: Record<string, string> = {
  ET: 'America/New_York', CT: 'America/Chicago', MT: 'America/Denver', PT: 'America/Los_Angeles',
  EASTERN: 'America/New_York', CENTRAL: 'America/Chicago', MOUNTAIN: 'America/Denver', PACIFIC: 'America/Los_Angeles',
};

/** Resolve "CEST", "ET", "Central", "UTC+3", "UTC+05:30" to a Zone. Returns null if unknown. */
export function resolveZone(label: string | null | undefined): Zone | null {
  if (!label) return null;
  const t = label.replace(/−/g, '-').trim();
  const utc = /^(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(t);
  if (utc) return { offsetMin: (utc[1] === '-' ? -1 : 1) * (Number(utc[2]) * 60 + Number(utc[3] ?? 0)) };
  const key = t.toUpperCase().replace(/\s*TIME$/, '');
  if (key in FIXED) return { offsetMin: FIXED[key] };
  if (key in IANA_LABELS) return { iana: IANA_LABELS[key] };
  return null;
}

function ianaOffsetMin(ms: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const v: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') v[p.type] = Number(p.value);
  const asUtc = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** Wall-clock time in `zone` to a UTC ISO string without milliseconds. */
export function localToUtc(y: number, m: number, d: number, h: number, mi: number, zone: Zone): string {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t: number;
  if ('offsetMin' in zone) t = guess - zone.offsetMin * 60000;
  else {
    const o1 = ianaOffsetMin(guess, zone.iana);
    t = guess - o1 * 60000;
    const o2 = ianaOffsetMin(t, zone.iana);
    if (o2 !== o1) t = guess - o2 * 60000;
  }
  return new Date(t).toISOString().replace('.000Z', 'Z');
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthNum = (s: string): number => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;

export interface YMD {
  y: number;
  m: number;
  d: number;
}

export const isoDate = (x: YMD): string =>
  `${String(x.y).padStart(4, '0')}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`;

function valid(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * Date as written on Wikipedia: "{{Start date|2026|7|25|df=y}}", "16 January 2027",
 * "October 8, 2026", "Saturday, 27 February (4:40 pm)", "September 20" (needs ctx.year).
 * "January 9/10" gives the first day. Returns null if there is no usable date.
 */
export function parseDate(raw: string | undefined | null, ctx: ParseContext = {}): YMD | null {
  if (!raw) return null;
  const sd = /\{\{\s*(?:start[ _]date|dts)\s*\|([^}]*)\}\}/i.exec(raw);
  if (sd) {
    const n = sd[1].split('|').map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).map(Number);
    if (n.length >= 3 && valid(n[0], n[1], n[2])) return { y: n[0], m: n[1], d: n[2] };
  }
  const s = cleanText(raw)
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday)?\b\.?,?/gi, ' ')
    .trim();
  let day: number, mon: number, year: number | undefined;
  let m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?(?:,?\s+(\d{4}))?/.exec(s);
  if (m) {
    day = Number(m[1]); mon = monthNum(m[2]); year = m[3] ? Number(m[3]) : undefined;
  } else {
    m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[\/–-]\s*\d{1,2})?(?:,?\s+(\d{4}))?/.exec(s);
    if (!m) return null;
    mon = monthNum(m[1]); day = Number(m[2]); year = m[3] ? Number(m[3]) : undefined;
  }
  if (mon < 1) return null;
  if (year === undefined) {
    if (ctx.year === undefined) return null;
    year = ctx.year + (ctx.crossYear && mon <= 6 ? 1 : 0);
  }
  return valid(year, mon, day) ? { y: year, m: mon, d: day } : null;
}

export type ParsedTime = { kind: 'tbc' } | { kind: 'time'; h: number; mi: number; zoneLabel: string | null };

/**
 * Time as written: "20:00 [[BST]]", "7:30&nbsp;p.m. [[EDT]]", "--:--", "TBC GMT", "".
 * An alternative time inside {{small|...}} or after <br> is ignored.
 * "4:00/4:30 p.m." takes the first time and borrows the p.m.
 */
export function parseTime(raw: string | undefined | null): ParsedTime {
  const TBC: ParsedTime = { kind: 'tbc' };
  if (!raw) return TBC;
  const s = cleanText(raw.replace(/\{\{\s*small\s*\|[\s\S]*?\}\}/gi, ' ').split(/<br\s*\/?>/i)[0]);
  if (!s || /^(?:tbc|tbd|tba|n\/a|\?|-)/i.test(s)) return TBC;
  if (/^noon\b/i.test(s)) return { kind: 'time', h: 12, mi: 0, zoneLabel: findZoneLabel(s.slice(4)) };
  const m = /^\D*?(\d{1,2})(?:[:.](\d{2}))?\s*(?:([ap])\.?\s*m\b\.?)?/i.exec(s);
  if (!m) return TBC;
  let h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  let mer = m[3]?.toLowerCase();
  const rest = s.slice(m[0].length);
  if (!mer && h <= 12) {
    const later = /\b([ap])\.?\s*m\b/i.exec(rest);
    if (later) mer = later[1].toLowerCase();
  }
  if (m[2] === undefined && !mer) return TBC;
  if (mer) h = (h % 12) + (mer === 'p' ? 12 : 0);
  if (h > 23 || mi > 59) return TBC;
  return { kind: 'time', h, mi, zoneLabel: findZoneLabel(rest) };
}

function findZoneLabel(s: string): string | null {
  // Abbreviations only (CET, ET, UTC+3); spelled-out names in a time cell are too ambiguous.
  const re = /\b(?:UTC|GMT)\s*[+\-\u2212]\s*\d{1,2}(?::?\d{2})?|\b[A-Z]{2,5}\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) if (resolveZone(m[0])) return m[0];
  return null;
}

export interface Kickoff {
  kickoffAt: string | null;
  timeTbc: boolean;
}

/** Combine a parsed date and time into a UTC kickoff. A label on the time wins over `fallback`. */
export function toKickoff(date: YMD, time: ParsedTime, fallback: Zone | null): Kickoff {
  if (time.kind === 'tbc') return { kickoffAt: null, timeTbc: true };
  const zone = resolveZone(time.zoneLabel) ?? fallback ?? { offsetMin: 0 };
  return { kickoffAt: localToUtc(date.y, date.m, date.d, time.h, time.mi, zone), timeTbc: false };
}
