import { useEffect, useState } from 'react';
import type { ExtensionStatusRequest, ExtensionStatusResponse } from '../types';
import { MessageType } from '../types';

export function App() {
  const [status, setStatus] = useState<ExtensionStatusResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    chrome.runtime.sendMessage<ExtensionStatusRequest, ExtensionStatusResponse>({ type: MessageType.ExtensionStatus })
      .then((s) => setStatus(s))
      .catch(() => setError(true));
  }, []);

  const s = status?.stats;
  const scheduleName = status?.scheduleName;
  const minutesRemaining = status?.minutesRemaining;

  return (
    <>
      <header>
        <h1>Screener</h1>
        {error ? (
          <>
            <span>Extension error</span>
            <span>Check chrome://extensions</span>
          </>
        ) : scheduleName ? (
          <>
            <span>Active: {scheduleName}</span>
            {minutesRemaining !== null && minutesRemaining !== undefined ? (
              <span>
                Remaining: {Math.floor(minutesRemaining / 60)}h{' '}
                {minutesRemaining % 60}m
              </span>
            ) : (
              <span />
            )}
          </>
        ) : (
          <>
            <span>No active schedule</span>
            <span />
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