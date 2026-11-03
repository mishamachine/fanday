// {{AFLGame|date (time)|home||V|away||venue||}} rows from "{year} AFL season" pages.
// Times are local to the venue. Rows with no date yet (later rounds) are skipped.

import type { ParsedGame, ParseContext, TeamRef } from '../types.ts';
import { cleanText, cleanWikitext, findHeadings, findTemplates, sectionAt } from '../wikitext.ts';
import { isoDate, parseDate, parseTime, toKickoff, type Zone } from '../time.ts';
import { statusFromScore, textOrNull } from './common.ts';

export const AFL_TEAMS: Record<string, TeamRef> = {
  Ade: { name: 'Adelaide Crows', page: 'Adelaide Football Club' },
  BL: { name: 'Brisbane Lions', page: 'Brisbane Lions' },
  Car: { name: 'Carlton', page: 'Carlton Football Club' },
  Col: { name: 'Collingwood', page: 'Collingwood Football Club' },
  Ess: { name: 'Essendon', page: 'Essendon Football Club' },
  Fre: { name: 'Fremantle', page: 'Fremantle Football Club' },
  Gee: { name: 'Geelong Cats', page: 'Geelong Football Club' },
  GC: { name: 'Gold Coast Suns', page: 'Gold Coast Football Club' },
  GWS: { name: 'GWS Giants', page: 'Greater Western Sydney Giants' },
  Haw: { name: 'Hawthorn', page: 'Hawthorn Football Club' },
  Mel: { name: 'Melbourne', page: 'Melbourne Football Club' },
  NM: { name: 'North Melbourne', page: 'North Melbourne Football Club' },
  PA: { name: 'Port Adelaide', page: 'Port Adelaide Football Club' },
  Ric: { name: 'Richmond', page: 'Richmond Football Club' },
  StK: { name: 'St Kilda', page: 'St Kilda Football Club' },
  Syd: { name: 'Sydney Swans', page: 'Sydney Swans' },
  WC: { name: 'West Coast Eagles', page: 'West Coast Eagles' },
  WB: { name: 'Western Bulldogs', page: 'Western Bulldogs' },
};

/** AFL venue to local zone. Victoria, NSW, ACT and Tasmania share AEST/AEDT; the others differ. */
export function aflVenueZone(venue: string): Zone {
  const v = venue.toLowerCase();
  const iana = /perth|optus/.test(v) ? 'Australia/Perth'
    : /adelaide oval|norwood|barossa|football park|unley/.test(v) ? 'Australia/Adelaide'
    : /gabba|carrara|metricon|heritage bank|cazaly|cairns|people first|mackay|riverway|townsville/.test(v) ? 'Australia/Brisbane'
    : /marrara|tio |darwin|traeger|alice springs/.test(v) ? 'Australia/Darwin'
    : /manuka|sydney|scg|engie|giants stadium|accor|homebush|canberra/.test(v) ? 'Australia/Sydney'
    : /bellerive|university of tasmania|york park|blundstone|launceston|hobart|ninja/.test(v) ? 'Australia/Hobart'
    : /wellington|sky stadium|dunedin|auckland/.test(v) ? 'Pacific/Auckland'
    : 'Australia/Melbourne';
  return { iana };
}

export function parseAfl(wikitext: string, ctx: ParseContext = {}): ParsedGame[] {
  const text = cleanWikitext(wikitext);
  const headings = findHeadings(text);
  const out: ParsedGame[] = [];
  for (const t of findTemplates(text, ['aflgame'])) {
    const [dateRaw, homeRaw, homeScore, , awayRaw, awayScore, venueRaw] = t.positional;
    const code = (raw: string | undefined) => /\{\{\s*AFL\s*\|\s*([A-Za-z]+)/i.exec(raw ?? '')?.[1];
    const home = AFL_TEAMS[code(homeRaw) ?? ''];
    const away = AFL_TEAMS[code(awayRaw) ?? ''];
    const date = parseDate(dateRaw, ctx);
    if (!home || !away || !date) continue;
    const venue = textOrNull(venueRaw);
    const timeRaw = /\(([^)]*)\)/.exec(cleanText(dateRaw))?.[1];
    const { kickoffAt, timeTbc } = toKickoff(date, parseTime(timeRaw), aflVenueZone(venue ?? ''));
    out.push({
      home, away, date: isoDate(date), kickoffAt, timeTbc,
      status: statusFromScore(`${cleanText(homeScore)}${cleanText(awayScore)}`),
      venue, broadcast: null,
      section: sectionAt(headings, t.start),
    });
  }
  return out;
}
