// Edge Function `fanday-ingest` (Deno). Not deployed by this PR.
//
// POST /functions/v1/ingest-wikipedia
//   header  x-ingest-secret: <FANDAY_INGEST_SECRET>
//   body    {"mode":"daily"|"gameday","cursor":0,"league":"epl"}   (cursor and league optional)
// A run handles pages until its time budget is spent and returns nextCursor; callers loop until done.
//
// Env (set as Supabase secrets by Babar): FANDAY_INGEST_SECRET. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
// Deploy with verify_jwt = false: the shared secret is the only credential.

import { createFetcher } from './mediawiki.ts';
import { createRestDb } from './db-rest.ts';
import { runIngest, type Mode } from './ingest.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const secret = Deno.env.get('FANDAY_INGEST_SECRET');
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !url || !key) return json(500, { error: 'function is not configured' });
  if (!safeEqual(req.headers.get('x-ingest-secret') ?? '', secret)) return json(401, { error: 'unauthorized' });

  let body: { mode?: string; cursor?: number; league?: string } = {};
  try { body = await req.json(); } catch { /* an empty body means defaults */ }
  const mode = (body.mode ?? 'daily') as Mode;
  if (mode !== 'daily' && mode !== 'gameday') return json(400, { error: 'mode must be daily or gameday' });

  const wiki = createFetcher();
  try {
    const summary = await runIngest(
      { mode, cursor: Number.isInteger(body.cursor) ? body.cursor : 0, league: typeof body.league === 'string' ? body.league : undefined },
      { db: createRestDb(url, key), fetchPages: wiki, pagesExist: wiki.exists, now: () => Date.now(), log: (m) => console.warn(m) },
    );
    console.log(JSON.stringify(summary));
    return json(200, summary);
  } catch (e) {
    console.error('ingest failed:', (e as Error).message);
    return json(500, { error: (e as Error).message });
  }
});
