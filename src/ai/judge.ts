import type { ProviderConfig, Schedule, VideoMetadata, Adapter, NoulDecision } from '../types';
import { jev } from './jev';
import { mock } from './mock';

const RETRY_DELAYS_MS = [400, 1200];

function adapterFor(config: ProviderConfig): Adapter {
  switch (config.kind) {
    case 'mock':
      return mock;
    case 'jev':
    default:
      return jev;
  }
}

export interface JudgeResult {
  decision: NoulDecision | null;
  error?: string;
  usedFallback?: boolean;
  primaryError?: string;
}

async function callOnce(
  config: ProviderConfig,
  apiKey: string,
  schedule: Schedule,
  meta: VideoMetadata,
): Promise<JudgeResult> {
  const adapter = adapterFor(config);
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), config.timeoutMs);
  try {
    const decision = await adapter.call(config, apiKey, schedule, meta, ctrl.signal);
    return { decision };
  } catch (e) {
    return { decision: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Runs the decision-model judgement with timeout and retries for the primary
 * provider. If primary fails and a fallback provider is configured, tries the
 * fallback once. Returns a JudgeResult.
 */
export async function judge(
  config: ProviderConfig,
  apiKey: string,
  fallbackConfig: ProviderConfig | undefined,
  fallbackKey: string,
  schedule: Schedule,
  meta: VideoMetadata,
): Promise<JudgeResult> {
  let primaryError = '';
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const result = await callOnce(config, apiKey, schedule, meta);
    if (result.decision) return { ...result, usedFallback: false };
    primaryError = result.error ?? '';
    if (attempt < RETRY_DELAYS_MS.length) {
      await delay(RETRY_DELAYS_MS[attempt]!);
    }
  }

  if (!fallbackConfig) {
    return { decision: null, error: primaryError, primaryError, usedFallback: false };
  }

  const fbResult = await callOnce(fallbackConfig, fallbackKey, schedule, meta);
  if (fbResult.decision) {
    return { ...fbResult, primaryError, usedFallback: true };
  }

  return {
    decision: null,
    error: `primary: ${primaryError}; backup: ${fbResult.error ?? 'AI call failed'}`,
    primaryError,
    usedFallback: true,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
