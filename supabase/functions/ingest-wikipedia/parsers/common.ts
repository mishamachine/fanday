import type { GameStatus } from '../types.ts';
import { cleanText, linkTarget } from '../wikitext.ts';
import type { Zone } from '../time.ts';

export function statusFromScore(score: string | undefined | null): GameStatus {
  const s = cleanText(score);
  if (!s) return 'scheduled';
  if (/postpon|\bP\s*[–-]\s*P\b|abandon|suspend/i.test(s)) return 'postponed';
  if (/cancel|void/i.test(s)) return 'cancelled';
  return /\d/.test(s) ? 'final' : 'scheduled';
}

export function textOrNull(raw: string | undefined | null): string | null {
  const s = cleanText(raw);
  return s ? s : null;
}

export function broadcastOrNull(raw: string | undefined | null): string | null {
  const s = cleanText(raw);
  return !s || /^(?:tbd|tba|tbc|n\/a|none|-|—|–)$/i.test(s) ? null : s;
}

/** "[[2026 Miami Dolphins season|Miami Dolphins]]" -> "Miami Dolphins" (the club's own article name). */
export function seasonPage(raw: string | undefined | null): string | null {
  const t = linkTarget(raw);
  const m = t ? /^\d{4}(?:[\u2013-]\d{2,4})?\s+(.*?)\s+(?:season|team)$/.exec(t) : null;
  return m ? m[1] : null;
}

/** Local zone of an Australian, New Zealand or Las Vegas venue. Victoria, NSW, ACT share AEST/AEDT. */
export function venueZone(venue: string): Zone {
  const v = venue.toLowerCase();
  const iana = /perth|optus/.test(v) ? 'Australia/Perth'
    : /adelaide oval|norwood|barossa|football park|unley/.test(v) ? 'Australia/Adelaide'
    : /gabba|carrara|metricon|heritage bank|cazaly|cairns|people first|mackay|riverway|townsville|suncorp|lang park|queensland|cbus|sunshine coast|ballymore|dolphin/.test(v) ? 'Australia/Brisbane'
    : /marrara|tio |darwin|traeger|alice springs/.test(v) ? 'Australia/Darwin'
    : /bellerive|university of tasmania|york park|blundstone|launceston|hobart|ninja/.test(v) ? 'Australia/Hobart'
    : /go media|mount smart|eden park|auckland|wellington|sky stadium|dunedin|christchurch|waikato|fmg|hamilton|forsyth/.test(v) ? 'Pacific/Auckland'
    : /allegiant|las vegas/.test(v) ? 'America/Los_Angeles'
    : 'Australia/Sydney';
  return { iana };
}
