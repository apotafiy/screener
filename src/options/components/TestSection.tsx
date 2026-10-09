import React, { useState, useRef } from 'react';
import type { Schedule, Verdict, VerdictSource, TestCriteriaRequest, TestCriteriaResponse, NoulDecision } from '../../types';
import { MessageType } from '../../types';
import { parseVideoId } from '../../youtube';

interface Props {
  schedules: Schedule[];
}

interface TestResult {
  verdict: Verdict;
  reason?: string;
  nouls?: NoulDecision;
  source: VerdictSource;
  error?: string;
  warning?: string;
  viaFallback?: boolean;
  elapsed: number;
  title: string;
  channel: string;
}

function noulSummary(n: NoulDecision): string {
  const parts: string[] = [];
  if (n.matchesBlock !== undefined) parts.push(`P(matches block) ${n.matchesBlock.toFixed(2)}`);
  if (n.matchesAllow !== undefined) parts.push(`P(matches allow) ${n.matchesAllow.toFixed(2)}`);
  return parts.join(' · ');
}

export function TestSection({ schedules }: Props) {
  const [result, setResult] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState(
    schedules[0]?.id || '',
  );

  const urlRef = useRef<HTMLInputElement>(null);

  const currentSelectedId =
    schedules.length > 0 &&
    schedules.some((s) => s.id === selectedScheduleId)
      ? selectedScheduleId
      : schedules[0]?.id || '';

  const handleTest = async () => {
    const schedule = schedules.find((s) => s.id === currentSelectedId);
    if (!schedule) return;

    setResult(null);
    setError(null);

    const url = urlRef.current?.value.trim() || '';
    const videoId = url ? parseVideoId(url) : null;
    if (!videoId) {
      setError('Enter a valid YouTube video URL.');
      return;
    }

    setLoading(true);
    const now = Date.now();
    try {
      const res = await chrome.runtime.sendMessage<TestCriteriaRequest, TestCriteriaResponse>({
        type: MessageType.TestCriteria,
        schedule,
        videoId,
      });
      const elapsed = Date.now() - now;
      setResult({
        verdict: res.verdict,
        reason: res.reason,
        nouls: res.nouls,
        source: res.source,
        error: res.error,
        warning: res.warning,
        viaFallback: res.viaFallback,
        elapsed,
        title: res.title ?? '',
        channel: res.channel ?? '',
      });
    } catch (e) {
      setError('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <label>Schedule</label>
      <select
        id="test-schedule"
        value={currentSelectedId}
        onChange={(e) => setSelectedScheduleId(e.target.value)}
      >
        {schedules.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name || '(unnamed)'}
          </option>
        ))}
      </select>

      <label>Video URL</label>
      <input
        type="text"
        id="test-url"
        ref={urlRef}
        placeholder="https://www.youtube.com/watch?v=…"
      />

      <button className="primary" id="test-run" onClick={handleTest}>
        Test
      </button>

      {loading && (
        <div id="test-result" style={{ display: 'block', background: 'transparent', color: 'var(--text-muted)' }}>
          Testing…
        </div>
      )}

      {error && (
        <div id="test-result" className="error">
          {error}
        </div>
      )}

      {result && !error && (
        <div id="test-result" className={result.verdict}>
          <strong>{result.verdict.toUpperCase()}</strong> —{' '}
          {result.nouls ? noulSummary(result.nouls) : result.reason ?? ''}
          <br />
          <span style={{ fontSize: '11px', color: '#888' }}>
            source: {result.source}
            {result.viaFallback ? ' (via backup)' : ''} · {result.elapsed}ms ·{' '}
            {result.title} / {result.channel}
          </span>
          {result.warning && (
            <br />
          )}
          {result.warning && (
            <span style={{ color: '#e6a817' }}>{result.warning}</span>
          )}
          {result.error && (
            <br />
          )}
          {result.error && (
            <span style={{ color: '#c62828' }}>{result.error}</span>
          )}
        </div>
      )}
    </>
  );
}
