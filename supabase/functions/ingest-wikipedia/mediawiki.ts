// Polite MediaWiki API client: batched titles, descriptive User-Agent, maxlag, retries, a pause between calls.
// Uses only fetch() and setTimeout-free injected sleep, so Deno and Node both run it.

export const API = 'https://en.wikipedia.org/w/api.php';
export const USER_AGENT = 'Fanday/0.1 (machinemisha+fanday@gmail.com)';

export interface WikiPage {
  title: string;
  revid: number;
  wikitext: string;
}

export interface FetcherOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
  /** Pause between API calls. Wikipedia asks API clients to go serially. */
  delayMs?: number;
  /** Server lag (seconds) above which Wikipedia asks us to back off. */
  maxlag?: number;
  maxRetries?: number;
}

export function buildUrl(titles: string[], maxlag: number): string {
  const q = new URLSearchParams({
    action: 'query', prop: 'revisions', rvprop: 'content|ids', rvslots: 'main', format: 'json',
    redirects: '1', maxlag: String(maxlag), titles: titles.join('|'),
  });
  return `${API}?${q}`;
}

interface ApiJson {
  error?: { code: string; info?: string };
  query?: {
    normalized?: Array<{ from: string; to: string }>;
    redirects?: Array<{ from: string; to: string }>;
    pages?: Record<string, {
      title: string; missing?: unknown; invalid?: unknown;
      revisions?: Array<{ revid: number; slots?: { main?: { '*'?: string; content?: string } } }>;
    }>;
  };
}

/** Map each requested title to its page (following normalisation and redirects), or null if missing. */
export function extractPages(json: ApiJson, requested: string[]): Map<string, WikiPage | null> {
  const hop = (t: string) => {
    for (const list of [json.query?.normalized, json.query?.redirects]) {
      const m = list?.find((x) => x.from === t);
      if (m) t = m.to;
    }
    return t;
  };
  const byTitle = new Map<string, WikiPage>();
  for (const p of Object.values(json.query?.pages ?? {})) {
    const rev = p.revisions?.[0];
    const text = rev?.slots?.main?.['*'] ?? rev?.slots?.main?.content;
    if (rev && typeof text === 'string') byTitle.set(p.title, { title: p.title, revid: rev.revid, wikitext: text });
  }
  const out = new Map<string, WikiPage | null>();
  for (const t of requested) out.set(t, byTitle.get(hop(hop(t))) ?? null);
  return out;
}

export function createFetcher(opts: FetcherOptions = {}) {
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ua = opts.userAgent ?? USER_AGENT;
  const delayMs = opts.delayMs ?? 1000;
  const maxlag = opts.maxlag ?? 5;
  const maxRetries = opts.maxRetries ?? 3;
  let calls = 0;

  return async function fetchPages(titles: string[]): Promise<Map<string, WikiPage | null>> {
    for (let attempt = 0; ; attempt++) {
      if (calls++ > 0) await sleep(delayMs);
      const res = await f(buildUrl(titles, maxlag), { headers: { 'User-Agent': ua, 'Api-User-Agent': ua, Accept: 'application/json' } });
      const retryAfter = Number(res.headers.get('retry-after')) || 5;
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= maxRetries) throw new Error(`Wikipedia HTTP ${res.status}`);
        await sleep(retryAfter * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
      const json = (await res.json()) as ApiJson;
      if (json.error?.code === 'maxlag') {
        if (attempt >= maxRetries) throw new Error('Wikipedia maxlag: giving up for now');
        await sleep(retryAfter * 1000);
        continue;
      }
      if (json.error) throw new Error(`Wikipedia API error ${json.error.code}`);
      return extractPages(json, titles);
    }
  };
}
