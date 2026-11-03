import type { ParsedGame, ParseContext, ParserKind } from './types.ts';
import { parseFootball } from './parsers/football.ts';
import { parseAfl } from './parsers/afl.ts';
import { parseCbb, parseCfb } from './parsers/college.ts';
import { parseNfl } from './parsers/nfl.ts';

const PARSERS: Record<ParserKind, (wikitext: string, ctx: ParseContext) => ParsedGame[]> = {
  football: parseFootball,
  afl: parseAfl,
  cfb: parseCfb,
  cbb: parseCbb,
  nfl: parseNfl,
};

/** NBA and NHL are intentionally absent: they use official calendar links, not Wikipedia. */
export function parseWikitext(kind: ParserKind, wikitext: string, ctx: ParseContext = {}): ParsedGame[] {
  return PARSERS[kind](wikitext, ctx);
}
