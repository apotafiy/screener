# Screener – Content Filter for the Web

Blocks content that doesn't match your acceptance criteria, on a schedule you define. Currently supports YouTube, with more platforms (e.g. Reddit) planned. Suitable for self-imposed limits or parental content control.

## Install

1. `npm install && npm run build`
2. Open `chrome://extensions` (or `brave://extensions`)
3. Toggle **Developer mode**
4. **Load unpacked** → select the `dist/` folder

## Provider Setup

Open **Options** (right-click the extension icon):

1. Under **AI Provider**, pick your service (Jev via OpenRouter or TypeSafe, or Mock). You only need to supply your own API key.
2. Enter your **API key** and select a **Model**.
3. Click **Save**. The first save for a real provider asks for host permission — allow it, or the extension won't be able to reach the API.

### Decision-model provider

Screener uses **decision models** exclusively — models that return a typed allow/block decision with calibrated probabilities instead of prose. The default provider is **Jev**, TypeSafe's "System One" decision model (served here via OpenRouter). Decision models are fast, cheap (input tokens only), and structurally can't be mis-parsed.

Two Jev presets are available:

- **OpenRouter (Jev decision model)** — `typesafe/jev-1.13` via OpenRouter, an account you may already have. Default.
- **TypeSafe (Jev decision model)** — the official `api.typesafe.ai` route. Note: TypeSafe paused new console signups in Sep 2026 (early access); use OpenRouter if you don't already have a TypeSafe key.

Internally the check is expressed as two calibrated yes/no (`noul`) questions — "matches the BLOCK criteria?" and "clearly matches the ALLOW criteria?" — and the allow/block rules are applied in code (threshold 0.85), mirroring the documented rule order. The raw probabilities are cached and shown in the Test Criteria tool.

### Backup Provider (optional)

Enable the **backup provider** checkbox to specify a second AI service that is tried once when the primary provider fails. When both fail you see the error overlay (Retry/Continue); when only the primary fails and the backup succeeds, a small **toast** appears instead (once per schedule window). The backup uses its own API key, model, and timeout — consider a shorter timeout since it's a last-resort path.

To test without an API key: use the **Mock** preset. It blocks any video whose title contains "BLOCKME" (case-insensitive) and allows everything else.

## Usage

### Schedule a blocking window

Add a schedule in the Options page:
- **Days** — which days of the week
- **Start / End time** — when blocking is active (end before start = spans midnight)
- **Allow Criteria** — free text describing what to permit (leave empty to allow all)
- **Block Criteria** — free text describing what to block (leave empty to block nothing)
- **Keywords** — automatic case-insensitive substring matching on title and channel; prefix with `channel:` to match channel only; block-list wins over allow-list
- **Enabled** toggle to activate

Enable the schedule and **Save Schedules**. The toolbar icon shows a red **ON** badge when a schedule is active. While active, every `/watch` page you open (or navigate to via YouTube's in-page links) is paused and evaluated.

### Blocked video flow

If blocked, you see an overlay with the schedule name (and the matched keyword, for keyword blocks). Press **Watch anyway** to start a 5-minute countdown; when it completes you can watch that video until the schedule window ends. Leaving the page resets the wait. Once earned, the bypass survives reloads and browser restarts. This bypass can be turned off under **Blocking** in Options, in which case the overlay has no way to continue.

### Test criteria

Use the **Test Criteria** section in Options to evaluate a video against any schedule without waiting for a real blocking window. Paste a YouTube link and the extension resolves the same context a live check uses — title, channel, uploader tags, category, and the description — then runs the pipeline. This is 1:1 with a live judgement for that link.

The result shows verdict, source, and latency — plus the calibrated probabilities behind an AI verdict (e.g. `P(matches block) 0.98 · P(matches allow) 0.02`) so you can see how close a video is to the 0.85 threshold. When YouTube returns no metadata for the link (private, deleted, or a consent wall), the tool reports an error instead of guessing.

### Decision log

Every verdict is recorded (last 200 entries) with timestamp, title, verdict, source (`keyword`/`ai`/`cache`/`error`/`empty`/`bypass`/`dormant`), and details — the matched keyword for keyword verdicts, or the calibrated probabilities (`P(matches block) … · P(matches allow) …`) for AI and cache verdicts. Clear it from Options.

### Import / Export

Export downloads your settings as JSON (API key excluded by design). Import replaces all schedules and provider config after validation and a confirm dialog.

## Manual Test Checklist

- [ ] Off-schedule: no badge, videos play unimpeded
- [ ] Active schedule: red `ON` badge appears
- [ ] Block path: keyword match blocks video with matched keyword shown
- [ ] Allow path: keyword match allows video, overlay dismissed
- [ ] AI block path (requires real API key): criteria-based block
- [ ] AI allow path (requires real API key): criteria-based allow
- [ ] Countdown: press Watch anyway to start 5min wait, navigate away, return — wait reset
- [ ] Earned bypass: complete countdown, reload page (and restart browser) — bypass holds
- [ ] Bypass cleared: schedule window ends, video re-evaluated
- [ ] Midnight-spanning schedule: active across midnight correctly
- [ ] Age-restricted video: falls back to DOM scrape for metadata
- [ ] Bad/missing API key: error overlay with Retry/Continue; Continue plays video
- [ ] SPA navigation: navigate between two videos via YouTube's sidebar without page reload — each gets evaluated
- [ ] Test Criteria: paste URL, verify verdict matches live evaluation
- [ ] Export/Import round-trip preserves all settings
- [ ] Host permission granted on first Save for a real provider (check `chrome://extensions` → Screener → Details)
- [ ] Backup provider: primary fails, backup succeeds → toast appears (once per schedule window), video not blocked by error overlay
- [ ] Backup provider: primary and backup fail → error overlay with Retry/Continue
- [ ] Backup provider disabled → primary failure still shows error overlay (unchanged)

## Project Structure

### Script Lifecycles

- **`background/service-worker.ts`** — the MV3 background service worker. One instance runs per browser session (not per tab), woken on demand by messages and alarms, and shut down by Chrome when idle.
- **`content/gate.ts`** — injected fresh into every YouTube tab at `document_start`, and re-runs its checks on every SPA navigation to a new video within that tab.
- **`options/*`** and **`popup/*`** — only load when their respective page is opened (the Options page, or the toolbar popup).

```
src/
  types.ts        # All TypeScript interfaces and message types
  defaults.ts     # Provider presets, default settings, example schedule
  schema.ts       # Settings validator (shared by save/load/import)
  storage.ts      # chrome.storage wrappers (apiKey kept separate from settings)
  schedule.ts     # Weekly window matching (supports midnight spans)
  matcher.ts      # Keyword list matching (title/channel, channel: prefix)
  cache.ts        # 2000-entry LRU decision cache (storage.session, stores nouls)
  stats.ts        # Daily counters with lazy midnight rollover
  log.ts          # Decision log (last 200 entries)
  youtube.ts      # Video ID parsing, context resolver (watch page JSON, oEmbed)
  mutex.ts        # In-worker serialization helper for storage ops
  ai/
    decisions.ts  # NoulDecision threshold + verdict derivation
    jev.ts        # Jev (TypeSafe) decision-model adapter
    openai-decisions.ts # Placeholder for OpenAI's Decisions API (not yet public)
    mock.ts       # Deterministic mock adapter for testing
    judge.ts      # Adapter dispatch, timeout, retry/backoff, fallback logic
  background/
    service-worker.ts   # Full decision pipeline, message routing, badge, alarms
  content/
    gate.ts       # Overlay, playback suppression, SPA nav, countdown
  options/
    main.tsx      # React entry point
    App.tsx       # Top-level component, state management
    components/   # Provider, schedules, test criteria, log, import/export
  popup/
    main.tsx      # React entry point
    App.tsx       # Status display and daily counts
  public/
    gate.css      # Gate overlay styles (copied verbatim to dist/)
```

## Build

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # both Vite configs → dist/
```

The dual Vite build: `vite.config.ts` emits the ESM service worker, options page, and popup. `vite.content.config.ts` emits the content script as IIFE.

## Browser Support

- **Chrome** 102+
- **Brave** — identical support. Note: Shields does not block service-worker-originated network requests, so AI API calls work fine.
- **Edge / Opera / Vivaldi** — also Chromium-based, expected to work.
- **Firefox** — not supported (different MV3 background model; would need a `browser.*` shim).

## Troubleshooting

**Nothing happens on YouTube?** Check the service worker console (click "service worker" on the extension card in `chrome://extensions`). Verify a schedule is enabled and the current time falls within it.

**"Checked 0" in popup?** The popup reads local stats. It resets to zero at midnight and starts fresh.

**API calls failing?** The error overlay appears on the video. Check your API key and model name in Options → Provider. Make sure you granted host permission when prompted on the first Save (check `chrome://extensions` → Screener → Details → "Has access to sites"). Use the Mock preset to verify the pipeline without an API key.

**Blocked incorrectly?** Check the decision log in Options — it shows the source (keyword, AI, or cache) and, for keyword verdicts, the matched keyword. Tune your criteria in the Test Criteria tool, which also shows the calibrated probabilities behind an AI verdict.
