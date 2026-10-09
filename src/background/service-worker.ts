import type {
  CheckResponse,
  AnyRequest,
  ExtensionStatusResponse,
  Judgement,
  ProviderConfig,
  Schedule,
  Settings,
  TempAllow,
  VideoMetadata,
  TestCriteriaResponse,
  MetadataRequest,
  DescriptionRequest,
  MetadataScrapeResponse,
  DescriptionScrapeResponse,
  NoulDecision,
} from '../types';
import { MessageType, VerdictSource } from '../types';
import { loadSettings, loadApiKey, loadFallbackApiKey } from '../storage';
import { findActiveSchedule, minutesUntil } from '../schedule';
import { matchList } from '../matcher';
import { criteriaHash, cacheGet, cachePut } from '../cache';
import { presetById } from '../defaults';
import { judge } from '../ai/judge';
import { verdictFromNouls } from '../ai/decisions';
import { resolveVideoContext } from '../youtube';
import { appendLog } from '../log';
import { recordStats, loadStats, type StatField } from '../stats';
import { withLock } from '../mutex';

const TEMP_ALLOWS_KEY = 'tempAllows';
const FALLBACK_NOTICE_KEY = 'fallbackNotices';
const BADGE_ALARM = 'badge-tick';

// ---------------------------------------------------------------------------
// temp allows (earned bypasses, scoped to a schedule window)
// ---------------------------------------------------------------------------

async function loadTempAllows(): Promise<Record<string, TempAllow>> {
  const raw = await chrome.storage.local.get(TEMP_ALLOWS_KEY);
  const v = raw[TEMP_ALLOWS_KEY];
  return typeof v === 'object' && v !== null ? (v as Record<string, TempAllow>) : {};
}

async function saveTempAllows(allows: Record<string, TempAllow>): Promise<void> {
  await chrome.storage.local.set({ [TEMP_ALLOWS_KEY]: allows });
}

async function pruneTempAllows(now: number): Promise<void> {
  await withLock(async () => {
    const allows = await loadTempAllows();
    let changed = false;
    for (const [id, a] of Object.entries(allows)) {
      if (a.windowEndTs <= now) {
        delete allows[id];
        changed = true;
      }
    }
    if (changed) await saveTempAllows(allows);
  });
}

interface FallbackNotice {
  scheduleId: string;
  windowEndTs: number;
}

async function loadFallbackNotices(): Promise<Record<string, FallbackNotice>> {
  const raw = await chrome.storage.session.get(FALLBACK_NOTICE_KEY);
  const v = raw[FALLBACK_NOTICE_KEY];
  return typeof v === 'object' && v !== null ? (v as Record<string, FallbackNotice>) : {};
}

async function saveFallbackNotices(notices: Record<string, FallbackNotice>): Promise<void> {
  await chrome.storage.session.set({ [FALLBACK_NOTICE_KEY]: notices });
}

async function shouldShowFallbackToast(scheduleId: string, windowEndTs: number): Promise<boolean> {
  return withLock(async () => {
    const notices = await loadFallbackNotices();
    const existing = notices[scheduleId];
    if (existing && existing.windowEndTs === windowEndTs) return false;
    notices[scheduleId] = { scheduleId, windowEndTs };
    await saveFallbackNotices(notices);
    return true;
  });
}

async function pruneFallbackNotices(now: number): Promise<void> {
  await withLock(async () => {
    const notices = await loadFallbackNotices();
    let changed = false;
    for (const [id, n] of Object.entries(notices)) {
      if (n.windowEndTs <= now) {
        delete notices[id];
        changed = true;
      }
    }
    if (changed) await saveFallbackNotices(notices);
  });
}

// ---------------------------------------------------------------------------
// metadata resolution
// ---------------------------------------------------------------------------

async function scrapeMetadata(tabId: number): Promise<VideoMetadata | null> {
  try {
    const res = await chrome.tabs.sendMessage<MetadataRequest, MetadataScrapeResponse>(tabId, { type: MessageType.ScrapeMetadata });
    if (res && typeof res.title === 'string' && typeof res.channel === 'string') {
      return { title: res.title, channel: res.channel };
    }
    return null;
  } catch {
    return null;
  }
}

async function scrapeDescription(tabId: number): Promise<string | undefined> {
  try {
    const res = await chrome.tabs.sendMessage<DescriptionRequest, DescriptionScrapeResponse>(tabId, { type: MessageType.ScrapeDescription });
    if (res && typeof res.description === 'string' && res.description.trim() !== '') {
      return res.description.trim().slice(0, 1000);
    }
  } catch {
    // ignore
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// decision pipeline
// ---------------------------------------------------------------------------

interface Evaluation {
  judgement: Judgement;
  metadata: VideoMetadata | null;
}

function providerLabel(config: ProviderConfig): string {
  return presetById(config.presetId).label;
}

interface Decision {
  judgement: Judgement;
  nouls?: NoulDecision;
  primaryError?: string;
}

/**
 * Keyword match, empty-criteria allow, or the decision-model call. No cache,
 * log, or toast — side effects live with the callers.
 */
async function decide(
  schedule: Schedule,
  meta: VideoMetadata,
  settings: Settings,
): Promise<Decision> {
  const scheduleRef = { scheduleName: schedule.name, scheduleId: schedule.id };

  const block = matchList(schedule.blockKeywords, meta);
  if (block.matched) {
    return {
      judgement: {
        verdict: 'block',
        reason: `matches blocked keyword: ${block.entry}`,
        source: VerdictSource.Keyword,
        ...scheduleRef,
      },
    };
  }

  const allow = matchList(schedule.allowKeywords, meta);
  if (allow.matched) {
    return {
      judgement: {
        verdict: 'allow',
        reason: `matches allowed keyword: ${allow.entry}`,
        source: VerdictSource.Keyword,
        ...scheduleRef,
      },
    };
  }

  if (!schedule.allowCriteria.trim() && !schedule.blockCriteria.trim()) {
    return { judgement: { verdict: 'allow', source: VerdictSource.Empty, ...scheduleRef } };
  }

  const apiKey = await loadApiKey();
  const fallbackKey = settings.fallbackProvider ? await loadFallbackApiKey() : '';
  const result = await judge(
    settings.provider, apiKey,
    settings.fallbackProvider, fallbackKey,
    schedule, meta,
  );

  if (!result.decision) {
    return {
      judgement: {
        verdict: 'allow',
        source: VerdictSource.Error,
        error: result.error ?? 'AI call failed',
        ...scheduleRef,
      },
    };
  }

  return {
    nouls: result.decision,
    primaryError: result.primaryError,
    judgement: {
      verdict: verdictFromNouls(result.decision),
      source: VerdictSource.Ai,
      viaFallback: result.usedFallback,
      ...scheduleRef,
    },
  };
}

async function evaluate(
  videoId: string,
  tabId: number,
  settings: Settings,
): Promise<Evaluation> {
  const now = Date.now();
  const active = findActiveSchedule(settings.schedules, now);

  if (!active) {
    return { judgement: { verdict: 'allow', source: VerdictSource.Dormant }, metadata: null };
  }
  const { schedule, windowEndTs } = active;

  // earned bypass
  const allows = await loadTempAllows();
  const existing = allows[videoId];
  if (existing && existing.scheduleId === schedule.id && existing.windowEndTs > now) {
    return {
      judgement: {
        verdict: 'allow',
        source: VerdictSource.Bypass,
        scheduleName: schedule.name,
        scheduleId: schedule.id,
      },
      metadata: null,
    };
  }

  const primaryHash = criteriaHash(schedule, settings.provider);
  const fallbackProvider = settings.fallbackProvider;
  const fallbackHash = fallbackProvider ? criteriaHash(schedule, fallbackProvider) : undefined;

  // cache — check the primary entry, then the fallback entry, before any API call.
  const cached = await cacheGet(videoId, primaryHash);
  if (cached) {
    return {
      judgement: {
        verdict: verdictFromNouls(cached.nouls),
        source: VerdictSource.Cache,
        scheduleName: schedule.name,
        scheduleId: schedule.id,
        nouls: cached.nouls,
      },
      metadata: cached.title ? { title: cached.title, channel: '' } : null,
    };
  }

  // baseUrl is intentionally excluded from criteriaHash, so different Jev
  // endpoints (e.g. TypeSafe vs OpenRouter) with the same kind/model share a
  // cache slot. Skip the duplicate fallback lookup when both configs hash to
  // that slot.
  if (fallbackHash && fallbackHash !== primaryHash) {
    const fbCached = await cacheGet(videoId, fallbackHash);
    if (fbCached) {
      return {
        judgement: {
          verdict: verdictFromNouls(fbCached.nouls),
          source: VerdictSource.Cache,
          scheduleName: schedule.name,
          scheduleId: schedule.id,
          viaFallback: true,
          nouls: fbCached.nouls,
        },
        metadata: fbCached.title ? { title: fbCached.title, channel: '' } : null,
      };
    }
  }

  // Context shared by live checks and pasted-link tests: title, channel, tags,
  // category, and description. Fetched from the watch page; the open tab DOM is
  // a last resort for title/channel.
  let metadata = await resolveVideoContext(videoId);
  if (!metadata?.title && !metadata?.channel) {
    metadata = await scrapeMetadata(tabId);
  }
  if (!metadata) {
    return {
      judgement: {
        verdict: 'allow',
        source: VerdictSource.Error,
        error: 'Could not read video metadata.',
        scheduleName: schedule.name,
        scheduleId: schedule.id,
      },
      metadata: null,
    };
  }

  // Description fallback from the open tab when the watch page had none.
  if (!metadata.description) {
    metadata.description = await scrapeDescription(tabId);
  }

  const decision = await decide(schedule, metadata, settings);
  if (!decision.nouls) {
    if (decision.judgement.source === VerdictSource.Error) {
      console.error('Screener: AI call failed', decision.judgement.error);
      const detail = settings.fallbackProvider
        ? `the ${providerLabel(settings.provider)} API (primary) and the ${providerLabel(settings.fallbackProvider)} API (backup)`
        : `the ${providerLabel(settings.provider)} API`;
      return {
        judgement: {
          ...decision.judgement,
          error: `There was an error calling ${detail}. Full details have been logged in the extension's service worker console (chrome://extensions → Screener → service worker).`,
        },
        metadata: metadata,
      };
    }
    return { judgement: decision.judgement, metadata: metadata };
  }

  let warning: string | undefined;
  if (decision.judgement.viaFallback && decision.primaryError) {
    const show = await shouldShowFallbackToast(schedule.id, windowEndTs);
    if (show) {
      console.warn('Screener: primary provider failed, used backup', decision.primaryError);
      warning = `${providerLabel(settings.provider)} API failed, used backup provider. Details logged in the extension's service worker console.`;
    }
  }

  const cacheHash = decision.judgement.viaFallback && fallbackHash ? fallbackHash : primaryHash;
  await cachePut(videoId, cacheHash, decision.nouls, metadata.title);
  return { judgement: { ...decision.judgement, warning, nouls: decision.nouls }, metadata: metadata };
}

async function recordDecision(videoId: string, j: Judgement, meta: VideoMetadata | null): Promise<void> {
  if (j.source === VerdictSource.Dormant) return; // off-schedule: not logged

  const fields: StatField[] = ['checked', j.verdict === 'block' ? 'blocked' : 'allowed'];
  if (j.source === VerdictSource.Cache) fields.push('cached');
  if (j.source === VerdictSource.Error) fields.push('errors');
  await recordStats(fields);

  const title = meta?.title ?? videoId;
  await appendLog({
    timestamp: Date.now(),
    title,
    verdict: j.verdict,
    reason: j.reason,
    source: j.source,
    viaFallback: j.viaFallback,
    nouls: j.nouls,
  });
}

// ---------------------------------------------------------------------------
// badge
// ---------------------------------------------------------------------------

async function updateBadge(): Promise<void> {
  const settings = await loadSettings();
  const active = findActiveSchedule(settings.schedules, Date.now());
  if (active) {
    await chrome.action.setBadgeText({ text: 'ON' });
    await chrome.action.setBadgeBackgroundColor({ color: '#ff0000' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

// ---------------------------------------------------------------------------
// message handling
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: AnyRequest, sender, sendResponse) => {
  // Route on message type. sender.tab cannot distinguish content-script from
  // extension-page messages, since an options_page opens in a real tab.
  if (message.type === MessageType.Check) {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;
    handleCheck(message.videoId, tabId)
      .then(sendResponse)
      .catch((e) => sendResponse(failOpenResponse(message.videoId, e)));
    return true;
  }
  if (message.type === MessageType.TempBypass) {
    handleTempBypass(message.videoId)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === MessageType.ExtensionStatus) {
    handleExtensionStatus().then(sendResponse);
    return true;
  }
  if (message.type === MessageType.TestCriteria) {
    handleTestCriteria(message.schedule, message.videoId)
      .then(sendResponse)
      .catch((e) =>
        sendResponse({
          verdict: 'allow',
          source: VerdictSource.Error,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    return true;
  }
  if (message.type === MessageType.Ping) { // TODO is this used or needed?
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

function failOpenResponse(videoId: string, e: unknown): CheckResponse {
  return {
    type: MessageType.CheckResult,
    videoId,
    verdict: 'allow',
    source: VerdictSource.Error,
    error: e instanceof Error ? e.message : String(e),
    warning: undefined,
    viaFallback: undefined,
  };
}

async function handleCheck(videoId: string, tabId: number): Promise<CheckResponse> {
  let j: Judgement;
  let meta: VideoMetadata | null = null;
  let canBypass = false;

  try {
    const settings = await loadSettings();
    canBypass = settings.allowTempBypass !== false;
    const result = await evaluate(videoId, tabId, settings);
    j = result.judgement;
    meta = result.metadata;
  } catch (e) {
    // Unexpected failure (e.g. storage error) must still fail open.
    console.error('Screener: unexpected error during check', e);
    j = {
      verdict: 'allow',
      source: VerdictSource.Error,
      error: 'An unexpected error occurred. Full details have been logged in the extension\'s service worker console (chrome://extensions → Screener → service worker).',
    };
  }

  // Bookkeeping must never prevent the response from being sent.
  try {
    await recordDecision(videoId, j, meta);
  } catch (e) {
    console.warn('Screener: failed to record decision', e);
  }

  return {
    type: MessageType.CheckResult,
    videoId,
    verdict: j.verdict,
    reason: j.reason,
    source: j.source,
    scheduleName: j.scheduleName,
    error: j.error,
    warning: j.warning,
    viaFallback: j.viaFallback,
    canBypass,
  };
}

async function handleExtensionStatus(): Promise<ExtensionStatusResponse> {
  try {
    const settings = await loadSettings();
    const now = Date.now();
    const active = findActiveSchedule(settings.schedules, now);
    const stats = await loadStats();
    return {
      type: MessageType.ExtensionStatusResult,
      scheduleName: active ? active.schedule.name : null,
      minutesRemaining: active ? minutesUntil(active.windowEndTs, now) : null,
      stats,
    };
  } catch {
    return {
      type: MessageType.ExtensionStatusResult,
      scheduleName: null,
      minutesRemaining: null,
      stats: { date: '', checked: 0, blocked: 0, allowed: 0, cached: 0, errors: 0 },
    };
  }
}

async function handleTestCriteria(
  schedule: Schedule,
  videoId: string,
): Promise<TestCriteriaResponse> {
  const meta = await resolveVideoContext(videoId);
  if (!meta) {
    return {
      verdict: 'allow',
      source: VerdictSource.Error,
      error: 'Could not fetch video metadata for that link.',
    };
  }
  const decision = await decide(schedule, meta, await loadSettings());
  const j = decision.judgement;
  return {
    verdict: j.verdict,
    reason: j.source === VerdictSource.Empty ? 'no criteria configured' : j.reason,
    nouls: decision.nouls,
    source: j.source,
    error: j.error,
    warning: j.viaFallback && decision.primaryError
      ? `Primary provider failed (${decision.primaryError}). Used backup provider.`
      : undefined,
    viaFallback: j.viaFallback,
    title: meta.title,
    channel: meta.channel,
  };
}

async function handleTempBypass(videoId: string): Promise<void> {
  await withLock(async () => {
    const settings = await loadSettings();
    if (settings.allowTempBypass === false) return;
    const now = Date.now();
    const active = findActiveSchedule(settings.schedules, now);
    if (!active) return;
    const allows = await loadTempAllows();
    allows[videoId] = { scheduleId: active.schedule.id, windowEndTs: active.windowEndTs };
    await saveTempAllows(allows);
  });
}

// ---------------------------------------------------------------------------
// alarms + lifecycle
// ---------------------------------------------------------------------------

chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === BADGE_ALARM) {
    await updateBadge();
    await pruneTempAllows(Date.now());
    await pruneFallbackNotices(Date.now());
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await updateBadge();
});

void updateBadge();
