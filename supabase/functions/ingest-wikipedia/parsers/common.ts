import type { GameStatus } from '../types.ts';
import { cleanText } from '../wikitext.ts';

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
