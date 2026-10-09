export type ProviderKind = 'jev' | 'mock';

export type PresetId = 'openrouter-jev' | 'typesafe' | 'mock';

export enum MessageType {
  Check = 'CHECK',
  ScrapeMetadata = 'SCRAPE_METADATA',
  ScrapeDescription = 'SCRAPE_DESCRIPTION',
  TempBypass = 'TEMP_BYPASS',
  Ping = 'PING',
  ExtensionStatus = 'EXTENSION_STATUS',
  TestCriteria = 'TEST_CRITERIA',
  CheckResult = 'CHECK_RESULT',
  ExtensionStatusResult = 'EXTENSION_STATUS_RESULT',
  ScrapeResult = 'SCRAPE_RESULT',
  DescriptionResult = 'DESCRIPTION_RESULT',
}

export interface ProviderConfig {
  kind: ProviderKind;
  presetId: PresetId;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  /** 0=Sun .. 6=Sat, the day the window STARTS */
  days: number[];
  /** 0..1439, minutes since local midnight */
  startMinutes: number;
  /** end <= start means the window spans midnight into the next day */
  endMinutes: number;
  allowCriteria: string;
  blockCriteria: string;
  allowKeywords: string[];
  blockKeywords: string[];
}

export interface Settings {
  /** Version not used currently but maybe be helpful later */
  version: 1;
  provider: ProviderConfig;
  fallbackProvider?: ProviderConfig;
  /** Whether the block overlay offers the "Watch anyway" bypass. Defaults to true. */
  allowTempBypass?: boolean;
  /** How aggressively to block. Global. Defaults to 'medium'. */
  strictness?: Strictness;
  /** array order = precedence when schedules overlap */
  schedules: Schedule[];
}

export enum Strictness {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export type Verdict = 'allow' | 'block';

/**
 * A decision model's calibrated answers for the two content-filter questions.
 * A field is present exactly when the matching criteria were non-empty, so
 * presence itself records which questions were asked.
 */
export interface NoulDecision {
  /** Calibrated P(video matches the BLOCK criteria). */
  matchesBlock?: number;
  /** Calibrated P(video clearly matches the ALLOW criteria). */
  matchesAllow?: number;
}

export enum VerdictSource {
  Keyword = 'keyword',
  Ai = 'ai',
  Cache = 'cache',
  Error = 'error',
  Bypass = 'bypass',
  Empty = 'empty',
  Dormant = 'dormant',
}

export interface VideoMetadata {
  title: string;
  channel: string;
  description?: string;
  /** Uploader tags (videoDetails.keywords), the best source of game/brand names. */
  tags?: string[];
  /** YouTube category, e.g. Gaming, Film & Animation. */
  category?: string;
}

export interface Judgement {
  verdict: Verdict;
  reason?: string;
  source: VerdictSource;
  /** Optional because we don't always have a schedule (i.e. dormant verdict) */
  scheduleName?: string;
  scheduleId?: string;
  error?: string;
  warning?: string;
  viaFallback?: boolean;
  nouls?: NoulDecision;
}

export interface CacheEntry {
  videoId: string;
  criteriaHash: string;
  nouls: NoulDecision;
  title?: string;
}

export interface TempAllow {
  scheduleId: string;
  windowEndTs: number;
}

export interface Stats {
  date: string; // YYYY-MM-DD, local
  checked: number;
  blocked: number;
  allowed: number;
  cached: number;
  errors: number;
}

export interface LogEntry {
  timestamp: number;
  title: string;
  verdict: Verdict;
  reason?: string;
  source: VerdictSource;
  viaFallback?: boolean;
  nouls?: NoulDecision;
}

export type CheckRequest = { type: MessageType.Check; videoId: string };
export type MetadataRequest = { type: MessageType.ScrapeMetadata };
export type DescriptionRequest = { type: MessageType.ScrapeDescription };
export type TempBypassRequest = { type: MessageType.TempBypass; videoId: string };
export type PingRequest = { type: MessageType.Ping };
export type ExtensionStatusRequest = { type: MessageType.ExtensionStatus };
export type TestCriteriaRequest = {
  type: MessageType.TestCriteria;
  schedule: Schedule;
  videoId: string;
};

/** Messages sent from the content script (require sender.tab.id). */
export type TabRequest =
  | CheckRequest
  | MetadataRequest
  | DescriptionRequest
  | TempBypassRequest;

/** Messages sent from extension pages (options/popup). */
export type ExtensionRequest = ExtensionStatusRequest | TestCriteriaRequest;

/** Valid from either context. */
export type AnyRequest = TabRequest | ExtensionRequest | PingRequest;

export interface CheckResponse {
  type: MessageType.CheckResult;
  videoId: string;
  verdict: Verdict;
  reason?: string;
  source: VerdictSource;
  scheduleName?: string;
  error?: string;
  warning?: string;
  viaFallback?: boolean;
  /** Whether the block overlay should offer the "Watch anyway" bypass. */
  canBypass?: boolean;
}

export interface ExtensionStatusResponse {
  type: MessageType.ExtensionStatusResult;
  scheduleName: string | null;
  minutesRemaining: number | null;
  stats: Stats;
}

export interface MetadataScrapeResponse {
  type: MessageType.ScrapeResult;
  title: string;
  channel: string;
}

export interface DescriptionScrapeResponse {
  type: MessageType.DescriptionResult;
  description: string;
}

export interface TempBypassResponse {
  ok: boolean;
}

export interface TestCriteriaResponse {
  verdict: Verdict;
  reason?: string;
  nouls?: NoulDecision;
  source: VerdictSource;
  error?: string;
  warning?: string;
  viaFallback?: boolean;
  /** Resolved from the pasted link, for display. */
  title?: string;
  channel?: string;
}

export interface Adapter {
  call(
    config: ProviderConfig,
    apiKey: string,
    schedule: Schedule,
    meta: VideoMetadata,
    signal: AbortSignal,
  ): Promise<NoulDecision>;
}
