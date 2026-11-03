// Change detector tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './test-ingest-lib.mjs';

const { detectChanges, needsUpdate } = await load('detect.ts');

const base = { kickoff_at: '2026-08-21T19:00:00Z', time_tbc: false, status: 'scheduled', venue: 'Emirates Stadium', broadcast: null, source_rev: 100 };
const next = (patch) => ({ ...base, ...patch });

test('no change', () => {
  assert.deepEqual(detectChanges(base, next({})), []);
  assert.equal(needsUpdate(base, next({})), false);
});

test('kickoff moved: one row with old and new instant', () => {
  assert.deepEqual(detectChanges(base, next({ kickoff_at: '2026-08-21T16:30:00Z' })), [
    { field: 'kickoff_at', old_value: '2026-08-21T19:00:00Z', new_value: '2026-08-21T16:30:00Z' },
  ]);
});

test('time announced: TBC to a time gives kickoff_at and time_tbc rows', () => {
  const tbc = next({ kickoff_at: null, time_tbc: true });
  assert.deepEqual(detectChanges(tbc, base), [
    { field: 'kickoff_at', old_value: null, new_value: '2026-08-21T19:00:00Z' },
    { field: 'time_tbc', old_value: 'true', new_value: 'false' },
  ]);
  assert.deepEqual(detectChanges(base, tbc).map((c) => c.field), ['kickoff_at', 'time_tbc']);
});

test('status and venue changes', () => {
  assert.deepEqual(detectChanges(base, next({ status: 'postponed' })), [{ field: 'status', old_value: 'scheduled', new_value: 'postponed' }]);
  assert.deepEqual(detectChanges(base, next({ venue: 'Wembley Stadium' })), [{ field: 'venue', old_value: 'Emirates Stadium', new_value: 'Wembley Stadium' }]);
  assert.deepEqual(detectChanges(next({ venue: null }), base), [{ field: 'venue', old_value: null, new_value: 'Emirates Stadium' }]);
});

test('several fields at once', () => {
  const c = detectChanges(base, next({ kickoff_at: '2026-08-22T11:30:00Z', venue: 'Wembley Stadium', status: 'postponed' }));
  assert.deepEqual(c.map((x) => x.field), ['kickoff_at', 'status', 'venue']);
});

test('whitespace-only differences are ignored', () => {
  for (const venue of ['Emirates  Stadium', ' Emirates Stadium ', 'Emirates Stadium', 'Emirates\nStadium']) {
    assert.deepEqual(detectChanges(base, next({ venue })), [], JSON.stringify(venue));
    assert.equal(needsUpdate(base, next({ venue })), false);
  }
  assert.deepEqual(detectChanges(next({ venue: null }), next({ venue: '  ' })), []);
});

test('source_rev-only change is ignored', () => {
  assert.deepEqual(detectChanges(base, next({ source_rev: 101 })), []);
  assert.equal(needsUpdate(base, next({ source_rev: 101 })), false);
});

test('the same instant in another notation is not a change', () => {
  assert.deepEqual(detectChanges(next({ kickoff_at: '2026-08-21T19:00:00+00:00' }), base), []);
  assert.deepEqual(detectChanges(next({ kickoff_at: '2026-08-21T20:00:00+01:00' }), base), []);
});

test('broadcast changes update the row but are not game_changes', () => {
  const tv = next({ broadcast: 'Sky Sports' });
  assert.deepEqual(detectChanges(base, tv), []);
  assert.equal(needsUpdate(base, tv), true);
});

test('a moved game date is a game_date change; a missing date on either side is ignored', () => {
  assert.deepEqual(detectChanges({ ...base, game_date: '2026-08-21' }, { ...base, game_date: '2026-08-22' }), [
    { field: 'game_date', old_value: '2026-08-21', new_value: '2026-08-22' },
  ]);
  assert.deepEqual(detectChanges({ ...base, game_date: '2026-08-21' }, base), []);
});
