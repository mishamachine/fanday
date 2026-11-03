// Shared helpers for the test-ingest-*.mjs files. Run the tests with:  node scripts/test-ingest-parsers.mjs  (Node 24+ or 26)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../supabase/functions/ingest-wikipedia/', import.meta.url);
export const load = (name) => import(new URL(name, root).href);
export const fixture = (name) => readFileSync(fileURLToPath(new URL(`./test-ingest-fixtures/${name}.wikitext`, import.meta.url)), 'utf8');

/** Revision ids of the saved fixtures (also in each file's header comment). */
export const REVID = {
  arsenal: 1383432955, chiefs: 1383408476, alabama: 1383482255, afl: 1382991168, ucl: 1383370288,
  duke: 1382029301, miami: 1383404277, bayern: 1383429966, juve: 1383468310, barca: 1383486795, psg: 1383459425,
  america: 1379947540, flamengo: 1383313464, dodgers: 1383313454, dodgers27: 1382601125, storm: 1378892095, ipl: 1382256076, nrlres: 1381734277,
};
