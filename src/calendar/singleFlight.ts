/**
 * Run `fn` one at a time. A call made while a run is in progress does not start a second one beside it and is not
 * lost: it queues exactly one more run, which starts when the current one ends (any number of calls during a run
 * collapse into that one). Callers get the promise of the run that will include their request.
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let current: Promise<T> | null = null
  let queued: Promise<T> | null = null
  const start = (): Promise<T> => {
    const p: Promise<T> = fn().finally(() => { if (current === p) current = null })
    current = p
    return p
  }
  return () => {
    if (!current) return start()
    queued ??= current.then(() => undefined, () => undefined).then(() => { queued = null; return start() })
    return queued
  }
}
