import type { Adapter, NoulDecision } from '../types';

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(t);
        reject(new Error('aborted'));
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(new Error('aborted'));
        },
        { once: true },
      );
    }
  });
}

/**
 * Deterministic mock adapter for end-to-end testing without an API key.
 * Blocks when the title contains "BLOCKME" (case-insensitive), otherwise
 * allows, after a simulated latency. Returns calibrated-style nouls,
 * emitting a field only for criteria that are non-empty (like a real adapter).
 */
export const mock: Adapter = {
  async call(_config, _apiKey, schedule, meta, signal) {
    await delay(3000, signal);
    if (signal.aborted) throw new Error('aborted');
    const block = meta.title.toLowerCase().includes('blockme');
    const decision: NoulDecision = {};
    if (schedule.blockCriteria.trim()) decision.matchesBlock = block ? 0.99 : 0.01;
    if (schedule.allowCriteria.trim()) decision.matchesAllow = block ? 0.01 : 0.99;
    return decision;
  },
};
