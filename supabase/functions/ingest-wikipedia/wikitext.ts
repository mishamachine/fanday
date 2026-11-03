// Small wikitext toolkit: template finder, parameter splitter, text cleaner.
// Pure TypeScript, no Deno or Node APIs.

export interface Template {
  name: string; // normalised: lower case, no spaces/underscores/hyphens, no "#invoke:"
  start: number;
  end: number;
  named: Record<string, string>; // lower-cased keys, trimmed values
  positional: string[]; // trimmed
}

/** Remove HTML comments, <ref> tags and <nowiki>; keeps everything else untouched. */
export function cleanWikitext(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref\b[^>]*\/>/gi, '')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<\/?nowiki>/gi, '');
}

export function normalizeName(raw: string): string {
  return raw
    .replace(/^\s*#invoke:/i, '')
    .replace(/[\s_\-]+/g, '')
    .toLowerCase();
}

/** Index just past the "}}" that closes the "{{" at `start`, or -1. */
function matchEnd(text: string, start: number): number {
  let depth = 0;
  for (let k = start; k < text.length - 1; ) {
    const two = text.substr(k, 2);
    if (two === '{{') {
      depth++;
      k += 2;
    } else if (two === '}}') {
      depth--;
      k += 2;
      if (depth === 0) return k;
    } else k++;
  }
  return -1;
}

/** Split on a separator that sits outside {{ }} and [[ ]]. */
export function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let brace = 0;
  let bracket = 0;
  for (let i = 0; i < s.length; i++) {
    const two = s.substr(i, 2);
    if (two === '{{') {
      brace++;
      cur += two;
      i++;
    } else if (two === '}}') {
      brace = Math.max(0, brace - 1);
      cur += two;
      i++;
    } else if (two === '[[') {
      bracket++;
      cur += two;
      i++;
    } else if (two === ']]') {
      bracket = Math.max(0, bracket - 1);
      cur += two;
      i++;
    } else if (brace === 0 && bracket === 0 && s.startsWith(sep, i)) {
      out.push(cur);
      cur = '';
      i += sep.length - 1;
    } else cur += s[i];
  }
  out.push(cur);
  return out;
}

export function parseParams(body: string): { named: Record<string, string>; positional: string[] } {
  const parts = splitTopLevel(body, '|').slice(1);
  const named: Record<string, string> = {};
  const positional: string[] = [];
  for (const part of parts) {
    const m = /^\s*([^=\[\]{}|]+?)\s*=([\s\S]*)$/.exec(part);
    if (m) named[m[1].toLowerCase()] = m[2].trim();
    else positional.push(part.trim());
  }
  return { named, positional };
}

/** Find every template (at any nesting depth) whose normalised name is in `wanted`. */
export function findTemplates(text: string, wanted: string[]): Template[] {
  const set = new Set(wanted);
  const out: Template[] = [];
  let i = 0;
  while ((i = text.indexOf('{{', i)) !== -1) {
    let j = i + 2;
    while (j < text.length && !'|}\n{'.includes(text[j])) j++;
    const name = normalizeName(text.slice(i + 2, j));
    if (set.has(name)) {
      const end = matchEnd(text, i);
      if (end > 0) {
        const { named, positional } = parseParams(text.slice(i + 2, end - 2));
        out.push({ name, start: i, end, named, positional });
      }
    }
    i += 2;
  }
  return out;
}

export interface Heading {
  pos: number;
  level: number;
  title: string;
}

export function findHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  const re = /^(={2,6})[ \t]*(.+?)[ \t]*\1[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ pos: m.index, level: m[1].length, title: cleanText(m[2]) });
  return out;
}

/** Nearest heading above `pos` with level <= maxLevel (default 3). */
export function sectionAt(headings: Heading[], pos: number, maxLevel = 3): string | null {
  let found: string | null = null;
  for (const h of headings) {
    if (h.pos > pos) break;
    if (h.level <= maxLevel) found = h.title;
  }
  return found;
}

const FIRST_PARAM = new Set(['abbr', 'dowtooltip', 'small', 'nowrap', 'nobr', 'tooltip', 'big', 'dts']);

/** Wikitext to plain text: resolves common templates, links and markup. */
export function cleanText(raw: string | undefined | null): string {
  if (!raw) return '';
  let s = raw.replace(/&nbsp;|&#160;/gi, ' ').replace(/&ndash;/gi, '–').replace(/&amp;/gi, '&');
  for (let n = 0; n < 12; n++) {
    const next = s.replace(/\{\{([^{}]*)\}\}/g, (_m, inner: string) => {
      const parts = inner.split('|');
      const name = normalizeName(parts[0]);
      if (name === 'nbsp') return ' ';
      if (name === 'color' || name === 'colour') return (parts[parts.length - 1] ?? '').trim();
      if (FIRST_PARAM.has(name)) return (parts[1] ?? '').trim();
      return '';
    });
    if (next === s) break;
    s = next;
  }
  s = s
    .replace(/\[\[([^\[\]|]*)\|([^\[\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\[\]|]*)\]\]/g, '$1')
    .replace(/\[(?:https?:)?\/\/\S+\s+([^\]]*)\]/g, '$1')
    .replace(/\[(?:https?:)?\/\/\S+\]/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/'{2,}/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

/** Wikipedia article title from a link in raw wikitext: "[[Girona FC|Girona]]" -> "Girona FC". */
export function linkTarget(raw: string | undefined | null): string | null {
  const m = /\[\[([^\[\]|#]+)/.exec(raw ?? '');
  return m ? m[1].replace(/_/g, ' ').trim() : null;
}
