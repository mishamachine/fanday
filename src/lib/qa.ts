/**
 * QA-only test switch: VITE_QA_SHIFT_MIN shifts the first mock kickoff by N minutes so a moved kickoff can be tested.
 * Active only in `vite dev` (import.meta.env.DEV) or when the build was made with VITE_QA=1. Release builds set neither
 * (.env.example and the workflows do not), and scripts/test-qa-flag.mjs checks that.
 */
export function qaShiftMs(env: { DEV?: boolean; VITE_QA?: string; VITE_QA_SHIFT_MIN?: string } | undefined): number {
  if (!env) return 0 // plain node (tests) has no import.meta.env
  if (!(env.DEV === true || env.VITE_QA === '1')) return 0
  const n = Number(env.VITE_QA_SHIFT_MIN ?? 0)
  return Number.isFinite(n) ? n * 60_000 : 0
}
