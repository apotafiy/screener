import React, { useState, useEffect } from 'react';
import type { LogEntry, NoulDecision, Strictness } from '../../types';
import { loadLog, clearLog } from '../../log';

/** Local time from year to seconds; the tooltip keeps the locale form. */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Readable percentages; exact decimals stay in the tooltip. */
function noulSummary(n: NoulDecision): string {
  const parts: string[] = [];
  if (n.matchesBlock !== undefined) {
    parts.push(`${Math.round(n.matchesBlock * 100)}% match on block criteria.`);
  }
  if (n.matchesAllow !== undefined) {
    parts.push(`${Math.round(n.matchesAllow * 100)}% match on allow criteria.`);
  }
  return parts.join(' ') || '—';
}

/** Exact probabilities for the details tooltip. */
function noulExact(n: NoulDecision): string {
  const parts: string[] = [];
  if (n.matchesBlock !== undefined) {
    parts.push(`P(matches block) ${n.matchesBlock.toFixed(2)}`);
  }
  if (n.matchesAllow !== undefined) {
    parts.push(`P(matches allow) ${n.matchesAllow.toFixed(2)}`);
  }
  return parts.join(' · ');
}

function strictnessLabel(s?: Strictness): string {
  if (!s) return '—';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function detailsText(e: LogEntry): string {
  if (e.reason) return e.reason;
  if (e.nouls) return noulSummary(e.nouls);
  if (e.error) return e.error;
  return '—';
}

function detailsTitle(e: LogEntry): string | undefined {
  if (e.error) return e.error;
  if (e.nouls) return noulExact(e.nouls);
  return undefined;
}

export function LogSection() {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  const reload = async () => {
    const log = await loadLog();
    setEntries(log);
  };

  useEffect(() => {
    void reload();
  }, []);

  const handleClear = async () => {
    await clearLog();
    await reload();
  };

  return (
    <>
      <div>
        <button className="danger small" onClick={handleClear}>
          Clear
        </button>
      </div>
      <div id="log-table">
        {entries.length === 0 ? (
          <p style={{ color: '#999', fontSize: '13px', padding: '12px' }}>
            No decisions yet.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="log-time">Time</th>
                <th className="log-title">Title</th>
                <th className="log-schedule">Schedule</th>
                <th className="log-strictness" title="Strictness level in effect for this check">
                  Strictness
                </th>
                <th className="log-verdict">Verdict</th>
                <th className="log-source">Source</th>
                <th className="log-details">Details</th>
              </tr>
            </thead>
            <tbody>
              {entries
                .slice()
                .reverse()
                .map((e, i) => (
                  <tr key={`${e.timestamp}-${e.scheduleId ?? e.source}-${i}`}>
                    <td
                      className="log-time"
                      title={new Date(e.timestamp).toLocaleString()}
                    >
                      {formatTime(e.timestamp)}
                    </td>
                    <td className="log-title" title={e.title}>
                      {e.title.slice(0, 60)}
                    </td>
                    <td className="log-schedule" title={e.scheduleName ?? undefined}>
                      {e.scheduleName ?? '—'}
                    </td>
                    <td className="log-strictness">
                      {strictnessLabel(e.strictness)}
                    </td>
                    <td
                      className={`log-verdict ${
                        e.verdict === 'block' ? 'log-block' : 'log-allow'
                      }`}
                    >
                      {e.verdict}
                    </td>
                    <td
                      className="log-source"
                      title={e.viaFallback ? 'Backup provider used' : undefined}
                    >
                      {e.source}
                      {e.viaFallback ? '*' : ''}
                    </td>
                    <td
                      className="log-details"
                      title={detailsTitle(e)}
                    >
                      {e.lowConfidence ? (
                        <div>
                          <span
                            className="log-close-call"
                            title="Block was a close call against the allow criteria"
                          >
                            close call
                          </span>
                        </div>
                      ) : null}
                      <div>{detailsText(e)}</div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
