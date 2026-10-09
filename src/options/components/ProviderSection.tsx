import React, { useState } from 'react';
import type { ProviderConfig, PresetId } from '../../types';
import { PRESETS, DEFAULT_TIMEOUT_MS } from '../../defaults';
import { Help } from './Help';

interface Props {
  provider: ProviderConfig;
  setProvider: (p: ProviderConfig) => void;
  apiKey: string;
  setApiKey: (s: string) => void;
  fallbackProvider: ProviderConfig | undefined;
  setFallbackProvider: (p: ProviderConfig | undefined) => void;
  fallbackApiKey: string;
  setFallbackApiKey: (s: string) => void;
}

export function ProviderSection({
  provider,
  setProvider,
  apiKey,
  setApiKey,
  fallbackProvider,
  setFallbackProvider,
  fallbackApiKey,
  setFallbackApiKey,
}: Props) {
  const [showPrimaryKey, setShowPrimaryKey] = useState(false);
  const [showFallbackKey, setShowFallbackKey] = useState(false);

  const preset = PRESETS.find((p) => p.id === provider.presetId);
  const fbEnabled = !!fallbackProvider;
  const fbCfg = fallbackProvider;
  const fbPreset = fbCfg ? PRESETS.find((p) => p.id === fbCfg.presetId) : undefined;

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value as PresetId;
    const p = PRESETS.find((x) => x.id === id)!;
    setProvider({
      ...provider,
      presetId: id,
      kind: p.kind,
      baseUrl: p.baseUrl,
      model: p.model,
    });
  };

  const handleFbPresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value as PresetId;
    const p = PRESETS.find((x) => x.id === id)!;
    if (fbCfg) {
      setFallbackProvider({
        ...fbCfg,
        presetId: id,
        kind: p.kind,
        baseUrl: p.baseUrl,
        model: p.model,
      });
    }
  };

  const handleFbEnabledChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const p = PRESETS.find((x) => x.id === provider.presetId)!;
      setFallbackProvider({
        kind: p.kind,
        presetId: provider.presetId,
        baseUrl: p.baseUrl,
        model: p.model,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    } else {
      setFallbackProvider(undefined);
      setFallbackApiKey('');
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <label style={{ margin: 0 }}>AI Provider</label>
        <Help id="provider">
          Choose which decision-model service checks your videos. Jev returns a
          fast, typed allow/block decision with calibrated probabilities.
          &quot;Mock&quot; runs the full pipeline without any API key or cost,
          useful for testing schedules and criteria.
        </Help>
      </div>

      <select id="prov-preset" value={provider.presetId} onChange={handlePresetChange}>
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>

      <div className="field-row">
        <div>
          <label>Model</label>
          <input
            type="text"
            id="prov-model"
            value={provider.model}
            placeholder="jev-latest"
            disabled={provider.kind !== 'jev'}
            onChange={(e) => setProvider({ ...provider, model: e.target.value })}
          />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label style={{ margin: 0 }}>Timeout (ms)</label>
            <Help id="timeout">
              How long each model request may run before being aborted. On
              timeout the check is retried twice with short backoff before
              giving up — so the worst-case wait is several times this value.
              Default 5000 (5s) is already generous for decision models, which
              typically answer in a few hundred milliseconds.
            </Help>
          </div>
          <input
            type="number"
            id="prov-timeout"
            value={provider.timeoutMs}
            min={1000}
            max={120000}
            onChange={(e) =>
              setProvider({
                ...provider,
                timeoutMs: Number(e.target.value) || DEFAULT_TIMEOUT_MS,
              })
            }
          />
        </div>
      </div>

      {preset?.needsKey !== false && (
        <>
          <label>API Key</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type={showPrimaryKey ? 'text' : 'password'}
              id="prov-key"
              placeholder="your API key"
              value={apiKey}
              style={{ flex: 1 }}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button
              id="prov-key-reveal"
              className="small"
              style={{ flex: '0', whiteSpace: 'nowrap' }}
              type="button"
              onClick={() => setShowPrimaryKey((v) => !v)}
            >
              {showPrimaryKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </>
      )}

      <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <label style={{ margin: 0 }}>
          <input
            type="checkbox"
            id="prov-fb-enabled"
            checked={fbEnabled}
            onChange={handleFbEnabledChange}
          />
          Enable backup provider
        </label>
        <Help id="fb-provider">
          If the primary provider fails, the backup is tried once. You only see
          the error overlay when both providers fail; if only the primary
          fails, a small toast appears instead. The backup uses its own timeout
          and API key — consider a shorter timeout here since it&apos;s a
          last-resort path.
        </Help>
      </div>

      <div id="fb-provider-block" hidden={!fbEnabled}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px' }}>
          <label style={{ margin: 0 }}>Backup Provider</label>
        </div>
        <select
          id="fb-prov-preset"
          value={fbCfg?.presetId ?? 'openrouter-jev'}
          onChange={handleFbPresetChange}
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>

        <div className="field-row">
          <div>
            <label>Model</label>
            <input
              type="text"
              id="fb-prov-model"
              value={fbCfg?.model ?? ''}
              placeholder="jev-latest"
              disabled={fbCfg?.kind !== 'jev'}
              onChange={(e) => {
                if (fbCfg) setFallbackProvider({ ...fbCfg, model: e.target.value });
              }}
            />
          </div>
          <div>
            <label>Timeout (ms)</label>
            <input
              type="number"
              id="fb-prov-timeout"
              value={fbCfg?.timeoutMs ?? DEFAULT_TIMEOUT_MS}
              min={1000}
              max={120000}
              onChange={(e) => {
                if (fbCfg)
                  setFallbackProvider({
                    ...fbCfg,
                    timeoutMs: Number(e.target.value) || DEFAULT_TIMEOUT_MS,
                  });
              }}
            />
          </div>
        </div>
        {fbPreset?.needsKey !== false && (
          <>
            <label>API Key</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type={showFallbackKey ? 'text' : 'password'}
                id="fb-prov-key"
                placeholder="your API key"
                value={fallbackApiKey}
                style={{ flex: 1 }}
                onChange={(e) => setFallbackApiKey(e.target.value)}
              />
              <button
                id="fb-prov-key-reveal"
                className="small"
                style={{ flex: '0', whiteSpace: 'nowrap' }}
                type="button"
                onClick={() => setShowFallbackKey((v) => !v)}
              >
                {showFallbackKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}