/**
 * A minimal in-worker serialization helper. Chrome extension service workers
 * can have multiple async tasks in flight concurrently (e.g. several tabs
 * checking videos at once), each doing read-modify-write against the same
 * storage keys. Routing those read-modify-write operations through a single
 * promise chain prevents lost updates.
 *
 * A single global lock is sufficient at this scale; per-key locks are
 * unnecessary overhead.
 */
let chain: Promise<unknown> = Promise.resolve();

export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
