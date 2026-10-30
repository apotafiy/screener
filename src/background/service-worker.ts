import type {
  CheckResponse,
  AnyRequest,
  ExtensionStatusResponse,
  FinalJudgement,
  Judgement,
  ProviderConfig,
  Schedule,
  Settings,
  VideoMetadata,
  TestCriteriaResponse,
  MetadataRequest,
  DescriptionRequest,
  MetadataScrapeResponse,
  DescriptionScrapeResponse,
  NoulDecision,
} from '../types';
import { MessageType, Strictness, VerdictSource } from '../types';
import { loadSettings, loadApiKey, loadFallbackApiKey } from '../storage';
import {
  findActiveSchedules,
  localDateKey,
  scheduleInstanceKey,
  unbypassedSchedules,
} from '../schedule';
import { matchList } from '../matcher';
import { criteriaHash, cachePut, findCached } from '../cache';
import { presetById } from '../defaults';
import { judge } from '../ai/judge';
import { isCloseCallBlock, verdictFromNouls } from '../ai/decisions';
import { fallbackDecisions, finalizeJudgement, judgementFromCache } from '../outcome';
import { resolveVideoContext } from '../youtube';
import { appendLogs } from '../log';
import { recordStats, loadStats, type StatField } from '../stats';
import { addTempAllows, loadTempAllows, saveTempAllows, pruneTempAllows } from '../temp-allows';
import { withLock } from '../mutex';

const FALLBACK_NOTICE_KEY = 'fallbackNotices';
const BADGE_ALARM = 'badge-tick';

// ---------------------------------------------------------------------------
// temp allows (earned bypasses, scoped to a schedule window)
// ---------------------------------------------------------------------------

interface FallbackNotice {
  scheduleId: string;
  /** Local start date of the schedule window instance. */
  scheduleInstanceKey: string;
}

async function loadFallbackNotices(): Promise<Record<string, FallbackNotice>> {
  const raw = await chrome.storage.session.get(FALLBACK_NOTICE_KEY);
  const v = raw[FALLBACK_NOTICE_KEY];
  return typeof v === 'object' && v !== null ? (v as Record<string, FallbackNotice>) : {};
}

async function saveFallbackNotices(notices: Record<string, FallbackNotice>): Promise<void> {
  await chrome.storage.session.set({ [FALLBACK_NOTICE_KEY]: notices });
}

async function shouldShowFallbackToast(
  scheduleId: string,
  scheduleInstanceKey: string,
): Promise<boolean> {
  return withLock(async () => {
    const notices = await loadFallbackNotices();
    const existing = notices[scheduleId];
    if (existing && existing.scheduleInstanceKey === scheduleInstanceKey) return false;
    notices[scheduleId] = { scheduleId, scheduleInstanceKey };
    await saveFallbackNotices(notices);
    return true;
  });
}

async function pruneFallbackNotices(now: number): Promise<void> {
  await withLock(async () => {
    const notices = await loadFallbackNotices();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    // Keep yesterday too: a window spanning midnight still belongs to it.
    const cutoff = localDateKey(yesterday.getTime());
    let changed = false;
    for (const [id, n] of Object.entries(notices)) {
      if (typeof n.scheduleInstanceKey !== 'string' || n.scheduleInstanceKey < cutoff) {
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
  /** One entry per schedule, in evaluation order. Stops at first block/error. */
  decisions: Judgement[];
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

  const strictness = settings.strictness ?? Strictness.Medium;
  const verdict = verdictFromNouls(result.decision, strictness);
  const judgement: Judgement = {
    verdict,
    source: VerdictSource.Ai,
    viaFallback: result.usedFallback,
    ...scheduleRef,
    ...(verdict === 'block' && isCloseCallBlock(result.decision, strictness)
      ? { lowConfidence: true }
      : {}),
  };
  return {
    nouls: result.decision,
    primaryError: result.primaryError,
    judgement,
  };
}

async function evaluate(
  videoId: string,
  tabId: number,
  settings: Settings,
): Promise<Evaluation> {
  const now = Date.now();
  const active = findActiveSchedules(settings.schedules, now);
  const strictness = settings.strictness ?? Strictness.Medium;

  if (active.length === 0) return { decisions: [], metadata: null };

  // A schedule with a live earned bypass is skipped; the rest still apply.
  const allows = await loadTempAllows();
  const pending = unbypassedSchedules(active, allows[videoId] ?? [], now);
  const pendingIds = new Set(pending.map(({ schedule }) => schedule.id));
  const decisions: Judgement[] = [];

  let metadata: VideoMetadata | null = null;
  let cacheMeta: VideoMetadata | null = null;

  // Every active schedule must allow. Stop on the first block or error. Each
  // schedule appends one decision so the log records bypasses and cache hits,
  // not just the final verdict.
  for (const { schedule } of active) {
    const instanceKey = scheduleInstanceKey(schedule, now);
    if (!pendingIds.has(schedule.id)) {
      decisions.push({
        verdict: 'allow',
        source: VerdictSource.Bypass,
        scheduleName: schedule.name,
        scheduleId: schedule.id,
        scheduleInstanceKey: instanceKey,
      });
      continue;
    }

    const primaryHash = criteriaHash(schedule, settings.provider);
    const fallbackProvider = settings.fallbackProvider;
    const fallbackHash = fallbackProvider ? criteriaHash(schedule, fallbackProvider) : undefined;

    // cache — primary slot first, then the fallback slot when it differs.
    const hit = await findCached(videoId, primaryHash, fallbackHash);
    if (hit) {
      const judgement = judgementFromCache(
        hit.entry,
        schedule,
        instanceKey,
        strictness,
        hit.viaFallback,
      );
      decisions.push(judgement);
      if (hit.entry.title) cacheMeta = { title: hit.entry.title, channel: '' };
      if (judgement.verdict === 'block') {
        return { decisions, metadata: metadata ?? cacheMeta };
      }
      continue;
    }

    // Context shared by live checks and pasted-link tests: title, channel, tags,
    // category, and description. Fetched once and reused across schedules.
    if (!metadata) {
      let loaded = await resolveVideoContext(videoId);
      if (!loaded?.title && !loaded?.channel) {
        loaded = await scrapeMetadata(tabId);
      }
      if (!loaded) {
        decisions.push({
          verdict: 'allow',
          source: VerdictSource.Error,
          error: 'Could not read video metadata.',
          scheduleName: schedule.name,
          scheduleId: schedule.id,
          scheduleInstanceKey: instanceKey,
        });
        return { decisions, metadata: metadata ?? cacheMeta };
      }
      // Description fallback from the open tab when the watch page had none.
      if (!loaded.description) {
        loaded.description = await scrapeDescription(tabId);
      }
      metadata = loaded;
    }

    const decision = await decide(schedule, metadata, settings);
    if (!decision.nouls) {
      if (decision.judgement.source === VerdictSource.Error) {
        console.error('Screener: AI call failed', decision.judgement.error);
        const detail = settings.fallbackProvider
          ? `the ${providerLabel(settings.provider)} API (primary) and the ${providerLabel(settings.fallbackProvider)} API (backup)`
          : `the ${providerLabel(settings.provider)} API`;
        decisions.push({
          ...decision.judgement,
          error: `There was an error calling ${detail}. Full details have been logged in the extension's service worker console (chrome://extensions → Screener → service worker).`,
          scheduleInstanceKey: instanceKey,
        });
        return { decisions, metadata };
      }
      decisions.push({ ...decision.judgement, scheduleInstanceKey: instanceKey });
      if (decision.judgement.verdict === 'block') {
        return { decisions, metadata };
      }
      continue;
    }

    const cacheHash = decision.judgement.viaFallback && fallbackHash ? fallbackHash : primaryHash;
    await cachePut(videoId, cacheHash, decision.nouls, metadata.title);
    decisions.push({
      ...decision.judgement,
      nouls: decision.nouls,
      primaryError: decision.primaryError,
      scheduleInstanceKey: instanceKey,
    });
    if (decision.judgement.verdict === 'block') {
      return { decisions, metadata };
    }
  }

  return { decisions, metadata: metadata ?? cacheMeta };
}

async function recordDecisions(
  videoId: string,
  final: FinalJudgement,
  decisions: Judgement[],
  meta: VideoMetadata | null,
  strictness?: Strictness,
): Promise<void> {
  if (final.source === VerdictSource.Dormant) return; // off-schedule: not logged

  // Stats stay per video; the log gets one row per schedule.
  const fields: StatField[] = ['checked', final.verdict === 'block' ? 'blocked' : 'allowed'];
  if (final.source === VerdictSource.Cache) fields.push('cached');
  if (final.source === VerdictSource.Error) fields.push('errors');
  await recordStats(fields);

  const timestamp = Date.now();
  const title = meta?.title ?? videoId;
  await appendLogs(decisions.map((d) => ({
    timestamp,
    videoId,
    title,
    scheduleId: d.scheduleId,
    scheduleName: d.scheduleName,
    verdict: d.verdict,
    reason: d.reason,
    source: d.source,
    error: d.error,
    viaFallback: d.viaFallback,
    strictness,
    lowConfidence: d.lowConfidence,
    nouls: d.nouls,
  })));
}

// ---------------------------------------------------------------------------
// badge
// ---------------------------------------------------------------------------

async function updateBadge(): Promise<void> {
  const settings = await loadSettings();
  const active = findActiveSchedules(settings.schedules, Date.now());
  if (active.length > 0) {
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
    handleTempBypass(message.videoId, message.closeCall === true)
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

/**
 * Builds one warning from every schedule that used the backup, not only the
 * schedule whose verdict won. Notices still show once per schedule window.
 */
async function collectFallbackWarning(
  decisions: Judgement[],
  primaryLabel: string,
): Promise<string | undefined> {
  const used = fallbackDecisions(decisions);
  if (used.length === 0) return undefined;

  const names = new Set<string>();
  for (const d of used) {
    console.warn('Screener: primary provider failed, used backup', d.primaryError);
    if (!d.scheduleId || !d.scheduleInstanceKey) continue;
    if (await shouldShowFallbackToast(d.scheduleId, d.scheduleInstanceKey)) {
      names.add(d.scheduleName ?? 'a schedule');
    }
  }
  if (names.size === 0) return undefined;
  return `${primaryLabel} API failed, used backup provider for ${[...names].join(', ')}. Details logged in the extension's service worker console.`;
}

async function handleCheck(videoId: string, tabId: number): Promise<CheckResponse> {
  let decisions: Judgement[] = [];
  let meta: VideoMetadata | null = null;
  let primaryLabel: string | undefined;
  let tempBypassEnabled = false;
  let strictness: Strictness | undefined;

  try {
    const settings = await loadSettings();
    tempBypassEnabled = settings.allowTempBypass !== false;
    strictness = settings.strictness ?? Strictness.Medium;
    primaryLabel = providerLabel(settings.provider);
    const result = await evaluate(videoId, tabId, settings);
    decisions = result.decisions;
    meta = result.metadata;
  } catch (e) {
    // Unexpected failure (e.g. storage error) must still fail open.
    console.error('Screener: unexpected error during check', e);
    decisions = [{
      verdict: 'allow',
      source: VerdictSource.Error,
      error: 'An unexpected error occurred. Full details have been logged in the extension\'s service worker console (chrome://extensions → Screener → service worker).',
    }];
  }

  let warning: string | undefined;
  if (primaryLabel) {
    try {
      warning = await collectFallbackWarning(decisions, primaryLabel);
    } catch (e) {
      console.warn('Screener: failed to build fallback warning', e);
    }
  }
  const final = finalizeJudgement(decisions, warning);
  // A close-call block keeps the bypass even when the global setting is off;
  // otherwise the setting is authoritative. The content script sends this
  // flag back with the bypass request.
  const bypassOverride =
    !tempBypassEnabled && final.verdict === 'block' && final.lowConfidence === true;
  const canBypass = tempBypassEnabled || bypassOverride;

  // Bookkeeping must never prevent the response from being sent.
  try {
    await recordDecisions(videoId, final, decisions, meta, strictness);
  } catch (e) {
    console.warn('Screener: failed to record decision', e);
  }

  return {
    type: MessageType.CheckResult,
    videoId,
    canBypass,
    ...(bypassOverride ? { bypassOverride: true } : {}),
    ...final,
  };
}

async function handleExtensionStatus(): Promise<ExtensionStatusResponse> {
  try {
    const settings = await loadSettings();
    const now = Date.now();
    const active = findActiveSchedules(settings.schedules, now);
    const stats = await loadStats();
    return {
      type: MessageType.ExtensionStatusResult,
      schedules: active.map(({ schedule, windowEndTs }) => ({
        id: schedule.id,
        name: schedule.name,
        windowEndTs,
      })),
      stats,
    };
  } catch {
    return {
      type: MessageType.ExtensionStatusResult,
      schedules: [],
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

async function handleTempBypass(videoId: string, closeCall: boolean): Promise<void> {
  await withLock(async () => {
    const settings = await loadSettings();
    if (settings.allowTempBypass === false && !closeCall) return;
    const now = Date.now();
    const active = findActiveSchedules(settings.schedules, now);
    if (active.length === 0) return;
    const allows = await loadTempAllows();
    // One wait covers every schedule open right now, each until its own end.
    allows[videoId] = addTempAllows(
      allows[videoId] ?? [],
      active.map(({ schedule, windowEndTs }) => ({ scheduleId: schedule.id, windowEndTs })),
      now,
    );
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
