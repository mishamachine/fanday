// supabase/seed/teams_tz.sql: shape checks (no database needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sql = readFileSync(new URL('../supabase/seed/teams_tz.sql', import.meta.url), 'utf8');
const code = sql.replace(/--.*$/gm, '');
const rows = [...code.matchAll(/\('(mls-[a-z0-9-]+)', '([A-Za-z_\/]+)'\)/g)].map((m) => [m[1], m[2]]);

test('teams_tz.sql: one idempotent UPDATE of teams.tz for the 30 MLS teams', () => {
  assert.equal(rows.length, 30);
  assert.equal(new Set(rows.map((r) => r[0])).size, 30, 'ids are unique');
  assert.match(code, /update public\.teams t\s+set tz = v\.tz/);
  assert.match(code, /t\.league_id = 'mls'/);
  assert.doesNotMatch(code, /\b(insert|delete|drop|alter|truncate)\b/i);
  assert.doesNotMatch(code, /\bset\s+(?!tz\b)\w+\s*=/i, 'only tz is set');
});

test('teams_tz.sql: every zone is a real IANA zone, and the spread looks right', () => {
  for (const [id, tz] of rows) assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: tz }), `${id} ${tz}`);
  const by = (tz) => rows.filter((r) => r[1] === tz).length;
  assert.deepEqual([by('America/New_York'), by('America/Chicago'), by('America/Denver'), by('America/Los_Angeles')], [13, 8, 2, 7]);
  assert.equal(rows.find((r) => r[0] === 'mls-inter-miami-cf')[1], 'America/New_York');
  assert.equal(rows.find((r) => r[0] === 'mls-seattle-sounders-fc')[1], 'America/Los_Angeles');
});

test('teams_tz.sql: covers exactly the MLS ids of the foundation seed, when that file is present', (t) => {
  const path = fileURLToPath(new URL('../supabase/seed/teams.json', import.meta.url));
  if (!existsSync(path)) return t.skip('supabase/seed/teams.json comes from the foundation PR');
  const mls = JSON.parse(readFileSync(path, 'utf8')).filter((x) => x.league_id === 'mls').map((x) => x.id).sort();
  assert.deepEqual(rows.map((r) => r[0]).sort(), mls);
});
