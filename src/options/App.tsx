import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Settings, ProviderConfig, Schedule } from '../types';
import { Strictness } from '../types';
import { defaultSettings } from '../defaults';
import {
  loadSettings,
  saveSettings,
  loadApiKey,
  saveApiKey,
  loadFallbackApiKey,
  saveFallbackApiKey,
} from '../storage';
import { validateSettings, type ValidationError } from '../schema';
import { ProviderSection } from './components/ProviderSection';
import { SchedulesSection, uid } from './components/SchedulesSection';
import { TestSection } from './components/TestSection';
import { LogSection } from './components/LogSection';
import { ImportExportSection } from './components/ImportExportSection';
import { Toast } from './components/Toast';
import { Help } from './components/Help';

export function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [apiKey, setApiKey] = useState('');
  const [fallbackApiKey, setFallbackApiKey] = useState('');
  const [toast, setToast] = useState<{
    message: string;
    kind: 'success' | 'error';
  } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    (async () => {
      const s = await loadSettings();
      setSettings(s);
      const key = await loadApiKey();
      setApiKey(key);
      const fbKey = await loadFallbackApiKey();
      setFallbackApiKey(fbKey);
    })();
  }, []);

  const showToast = useCallback(
    (message: string, kind: 'success' | 'error') => {
      setToast({ message, kind });
    },
    [],
  );

  useEffect(() => {
    if (!toast) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [toast]);

  const setProvider = useCallback(
    (p: ProviderConfig) =>
      setSettings((prev) => ({ ...prev, provider: p })),
    [],
  );
  const setFallbackProvider = useCallback(
    (p: ProviderConfig | undefined) =>
      setSettings((prev) => ({ ...prev, fallbackProvider: p })),
    [],
  );
  const setSchedules = useCallback(
    (s: Schedule[]) =>
      setSettings((prev) => ({ ...prev, schedules: s })),
    [],
  );
  const setAllowTempBypass = useCallback(
    (b: boolean) =>
      setSettings((prev) => ({ ...prev, allowTempBypass: b })),
    [],
  );
  const setStrictness = useCallback(
    (s: Strictness) =>
      setSettings((prev) => ({ ...prev, strictness: s })),
    [],
  );

  function hostPatternForUrl(url: string): string | null {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return `${u.protocol}//${u.hostname}/*`;
    } catch {
      return null;
    }
  }

  const handleSaveAll = useCallback(async () => {
    const schedulesWithIds = settings.schedules.map((s) =>
      s.id ? s : { ...s, id: uid() },
    );
    const updated = { ...settings, schedules: schedulesWithIds };

    const urls: { pattern: string; label: string }[] = [];
    if (updated.provider.kind !== 'mock') {
      const p = hostPatternForUrl(updated.provider.baseUrl);
      if (p) urls.push({ pattern: p, label: 'primary' });
    }
    if (updated.fallbackProvider && updated.fallbackProvider.kind !== 'mock') {
      const p = hostPatternForUrl(updated.fallbackProvider.baseUrl);
      if (p) urls.push({ pattern: p, label: 'backup' });
    }
    for (const { pattern, label } of urls) {
      try {
        const granted = await chrome.permissions.request({ origins: [pattern] });
        if (!granted) {
          showToast(`Permission for ${label} (${pattern}) was denied — AI checks will fail until it's granted.`, 'error');
        }
      } catch {
        showToast(`Could not request permission for ${label} (${pattern}). Check the Base URL is a valid http(s) URL.`, 'error');
        return;
      }
    }
    const primaryNeedsUrl = updated.provider.kind !== 'mock' && !hostPatternForUrl(updated.provider.baseUrl);
    const fbNeedsUrl =
      updated.fallbackProvider &&
      updated.fallbackProvider.kind !== 'mock' &&
      !hostPatternForUrl(updated.fallbackProvider.baseUrl);
    if (primaryNeedsUrl || fbNeedsUrl) {
      showToast('Base URL must be a valid http(s) URL before saving.', 'error');
      return;
    }

    const { errors } = validateSettings(updated);
    if (errors.length > 0) {
      showToast(errors.map((e: ValidationError) => e.path + ': ' + e.message).join('; '), 'error');
      return;
    }

    setSettings(updated);
    await saveApiKey(apiKey);
    await saveFallbackApiKey(fallbackApiKey);
    await saveSettings(updated);
    showToast('All settings saved.', 'success');
  }, [settings, apiKey, fallbackApiKey, showToast]);

  const handleImport = useCallback(
    async (imported: Settings) => {
      setSettings(imported);
      await saveSettings(imported);
    },
    [],
  );

  useEffect(() => {
    function closeAllHelpPanels() {
      document.querySelectorAll<HTMLElement>('.help-panel').forEach((p) => p.setAttribute('hidden', ''));
      document.querySelectorAll<HTMLElement>('.help-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    }

    function positionHelpPanel(btn: HTMLElement, panel: HTMLElement) {
      const margin = 10;
      const btnRect = btn.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();

      let left = btnRect.left;
      if (left + panelRect.width > window.innerWidth - margin) {
        left = window.innerWidth - panelRect.width - margin;
      }
      if (left < margin) left = margin;

      let top = btnRect.bottom + 6;
      if (top + panelRect.height > window.innerHeight - margin) {
        const above = btnRect.top - panelRect.height - 6;
        top = above > margin ? above : margin;
      }

      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    }

    function handleClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest?.('.help-btn') as HTMLElement | null;
      if (target) {
        const id = target.dataset.help;
        if (!id) return;
        const panel = document.getElementById(`help-${id}`);
        if (!panel) return;
        const wasHidden = panel.hasAttribute('hidden');
        closeAllHelpPanels();
        if (wasHidden) {
          panel.removeAttribute('hidden');
          positionHelpPanel(target, panel);
          target.setAttribute('aria-expanded', 'true');
        }
        e.stopPropagation();
        return;
      }
      if ((e.target as HTMLElement).closest?.('.help-panel')) return;
      closeAllHelpPanels();
    }

    function handleResizeOrScroll() {
      closeAllHelpPanels();
    }

    document.addEventListener('click', handleClick);
    window.addEventListener('resize', handleResizeOrScroll);
    window.addEventListener('scroll', handleResizeOrScroll, true);

    return () => {
      document.removeEventListener('click', handleClick);
      window.removeEventListener('resize', handleResizeOrScroll);
      window.removeEventListener('scroll', handleResizeOrScroll, true);
    };
  }, []);

  return (
    <>
      <header>
        <h1>Screener</h1>
        <p>Content Filter for the Web</p>
      </header>

      <section>
        <h2>Provider</h2>
        <ProviderSection
          provider={settings.provider}
          setProvider={setProvider}
          apiKey={apiKey}
          setApiKey={setApiKey}
          fallbackProvider={settings.fallbackProvider}
          setFallbackProvider={setFallbackProvider}
          fallbackApiKey={fallbackApiKey}
          setFallbackApiKey={setFallbackApiKey}
        />
      </section>

      <section>
        <h2>
          Schedules
          <Help id="matching">
            <strong>Criteria</strong> are free text sent to the AI.{' '}
            <strong>Keywords</strong> are matched locally (case-insensitive
            substring on title and channel) with no API call. A block-keyword
            match wins over an allow-keyword match, and either one
            short-circuits before the AI runs. Prefix an entry with{' '}
            <code>channel:</code> to match the channel only. Empty allow
            criteria = allow everything; empty block criteria = block nothing;
            both empty = no API call at all. When two schedules overlap in
            time, the <strong>first enabled schedule in this list</strong>{' '}
            wins — use the arrow buttons to set priority.
          </Help>
        </h2>
        <SchedulesSection
          schedules={settings.schedules}
          setSchedules={setSchedules}
        />
      </section>

      <section>
        <h2>Blocking</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <label style={{ margin: 0 }}>
            <input
              type="checkbox"
              id="allow-temp-bypass"
              checked={settings.allowTempBypass !== false}
              onChange={(e) => setAllowTempBypass(e.target.checked)}
            />{' '}
            Allow &quot;Watch anyway&quot; bypass
          </label>
          <Help id="temp-bypass">
            When on, a blocked video shows a &quot;Watch anyway&quot; button that
            starts a 5-minute countdown; once it finishes, the video can be
            watched for the rest of the schedule window. Turn off to block with
            no bypass — the overlay then has no way to continue.
          </Help>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
          <label style={{ margin: 0 }} htmlFor="strictness">Strictness</label>
          <select
            id="strictness"
            value={settings.strictness ?? Strictness.Medium}
            onChange={(e) => setStrictness(e.target.value as Strictness)}
          >
            <option value={Strictness.Low}>Low (most permissive)</option>
            <option value={Strictness.Medium}>Medium</option>
            <option value={Strictness.High}>High (strictest)</option>
          </select>
          <Help id="strictness">
            How aggressively the AI verdict blocks, applied to every schedule.
            Low blocks only on strong signals; High blocks more readily. This
            only shifts the probability cutoffs — tune your criteria first.
          </Help>
        </div>
      </section>

      <section>
        <h2>Test Criteria</h2>
        <TestSection
          schedules={settings.schedules}
        />
      </section>

      <section>
        <h2>Decision Log</h2>
        <LogSection />
      </section>

      <section>
        <h2>Import / Export</h2>
        <ImportExportSection
          settings={settings}
          onImport={handleImport}
          showToast={showToast}
        />
      </section>

      <div style={{ textAlign: 'center', marginTop: '12px' }}>
        <button className="primary" onClick={handleSaveAll}>
          Save All Settings
        </button>
      </div>

      <Toast toast={toast} />
    </>
  );
}
