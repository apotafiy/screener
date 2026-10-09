import React, { useState, useEffect } from 'react';
import type { LogEntry, NoulDecision } from '../../types';
import { loadLog, clearLog } from '../../log';

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function noulSummary(n: NoulDecision): string {
  const parts: string[] = [];
  if (n.matchesBlock !== undefined) parts.push(`P(matches block) ${n.matchesBlock.toFixed(2)}`);
  if (n.matchesAllow !== undefined) parts.push(`P(matches allow) ${n.matchesAllow.toFixed(2)}`);
  return parts.join(' · ');
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
                <th>Time</th>
                <th>Title</th>
                <th>Verdict</th>
                <th>Source</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries
                .slice()
                .reverse()
                .map((e) => (
                  <tr key={e.timestamp}>
                    <td title={new Date(e.timestamp).toLocaleString()}>
                      {formatTime(e.timestamp)}
                    </td>
                    <td>{e.title.slice(0, 60)}</td>
                    <td
                      className={`log-${e.verdict === 'block'
                          ? 'block'
                          : e.verdict === 'allow'
                            ? 'allow'
                            : 'empty'
                        }`}
                    >
                      {e.verdict}
                    </td>
                    <td>
                      {e.source}
                      {e.viaFallback ? '*' : ''}
                    </td>
                    <td>{e.reason ?? (e.nouls ? noulSummary(e.nouls) : '')}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
