import { useEffect, useState } from 'react';
import type { ExtensionStatusRequest, ExtensionStatusResponse } from '../types';
import { MessageType } from '../types';
import { minutesUntil } from '../schedule';

function formatRemaining(minutes: number): string {
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
}

export function App() {
  const [status, setStatus] = useState<ExtensionStatusResponse | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    chrome.runtime.sendMessage<ExtensionStatusRequest, ExtensionStatusResponse>({ type: MessageType.ExtensionStatus })
      .then((s) => setStatus(s))
      .catch(() => setError(true));
  }, []);

  // The response carries each window's end, so the popup can tick locally
  // without waking the service worker every minute.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Drop a row exactly when its window closes, not on the next minute tick.
  useEffect(() => {
    if (!status) return;
    const next = status.schedules
      .map((x) => x.windowEndTs)
      .filter((ts) => ts > Date.now())
      .sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const timer = setTimeout(() => setNow(Date.now()), next - Date.now() + 50);
    return () => clearTimeout(timer);
  }, [status, now]);

  const s = status?.stats;
  const schedules = (status?.schedules ?? []).filter((x) => x.windowEndTs > now);

  return (
    <>
      <header>
        <h1>Screener</h1>
        {error ? (
          <>
            <span>Extension error</span>
            <span>Check chrome://extensions</span>
          </>
        ) : !status ? (
          <span>Loading…</span>
        ) : schedules.length === 0 ? (
          <span>No active schedule</span>
        ) : (
          <>
            <span>
              {schedules.length === 1
                ? 'Active schedule'
                : `Active schedules (${schedules.length})`}
            </span>
            <ul className="active-schedules">
              {schedules.map((x) => (
                <li key={x.id}>
                  <div className="sched-name" title={x.name}>{x.name || '(unnamed)'}</div>
                  <div className="sched-time">
                    {formatRemaining(minutesUntil(x.windowEndTs, now))}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </header>
      {s && (
        <div className="stats-grid">
          <div><span className="stat-val">{s.checked}</span><span className="stat-lbl">Checked</span></div>
          <div><span className="stat-val">{s.blocked}</span><span className="stat-lbl">Blocked</span></div>
          <div><span className="stat-val">{s.allowed}</span><span className="stat-lbl">Allowed</span></div>
          <div><span className="stat-val">{s.cached}</span><span className="stat-lbl">Cached</span></div>
          <div><span className="stat-val">{s.errors}</span><span className="stat-lbl">Errors</span></div>
        </div>
      )}
      <footer>
        <a
          href="#"
          id="so-options"
          onClick={(e) => {
            e.preventDefault();
            chrome.runtime.openOptionsPage();
          }}
        >
          Settings
        </a>
      </footer>
    </>
  );
}