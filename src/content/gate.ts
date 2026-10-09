// Screener gate — content script injected at document_start on YouTube.
//
// NOTE: styles live in public/gate.css.
import type { CheckRequest, CheckResponse, TempBypassRequest, TempBypassResponse, MetadataRequest, DescriptionRequest } from '../types';
import { MessageType } from '../types';

(() => {
  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
  const $ = (sel: string, parent: ParentNode = document): Element | null =>
    parent.querySelector(sel);
  const $$ = (sel: string, parent: ParentNode = document): NodeListOf<Element> =>
    parent.querySelectorAll(sel);

  // Tiny no-dependency Document.createElement wrapper for constructing the overlay DOM.
  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string> = {},
    ...children: (string | Node | (string | Node)[])[]
  ): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    for (const c of children.flat()) { e.append(c); }
    return e;
  }

  function empty(parent: HTMLElement): void {
    while (parent.firstChild) parent.firstChild.remove();
  }

  // ---------------------------------------------------------------------------
  // URL helpers
  // ---------------------------------------------------------------------------
  function getVideoId(): string | null {
    const url = new URL(location.href);
    if (url.pathname === '/watch') return url.searchParams.get('v');
    const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/);
    if (match) return match[1]!;
    return null;
  }

  function isWatchPage(): boolean {
    return getVideoId() !== null;
  }

  // ---------------------------------------------------------------------------
  // Playback suppression
  // ---------------------------------------------------------------------------
  let playObserver: MutationObserver | null = null;
  const suppressedVideos: Set<HTMLVideoElement> = new Set();

  function silenceVideo(v: HTMLVideoElement): void {
    if (suppressedVideos.has(v)) return;
    suppressedVideos.add(v);
    v.muted = true;
    v.pause();
    v.addEventListener('play', onVideoPlay, { capture: true, once: true });
  }

  // Uses once:true and re-registers on each fire rather than a persistent
  // listener, so each play attempt is a clean, isolated one-shot trap.
  function onVideoPlay(e: Event): void {
    const v = e.target as HTMLVideoElement;
    if (!suppressedVideos.has(v)) return;
    v.muted = true;
    v.pause();
    v.addEventListener('play', onVideoPlay, { capture: true, once: true });
  }

  function suppressPlayback(): void {
    if (playObserver) { playObserver.disconnect(); }
    suppressedVideos.clear();
    $$('video').forEach((v) => silenceVideo(v as HTMLVideoElement));
    playObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n instanceof HTMLVideoElement) silenceVideo(n);
          if (n instanceof Element) {
            n.querySelectorAll('video').forEach((v) => silenceVideo(v));
          }
        }
      }
    });
    playObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function restorePlayback(): void {
    if (playObserver) { playObserver.disconnect(); playObserver = null; }
    for (const v of suppressedVideos) {
      v.removeEventListener('play', onVideoPlay, { capture: true });
      v.muted = false;
      v.play().catch(() => { });
    }
    suppressedVideos.clear();
  }

  // ---------------------------------------------------------------------------
  // Overlay
  // ---------------------------------------------------------------------------
  let root: HTMLElement | null = null;

  function getOverlay(): HTMLElement {
    if (root) return root;
    root = el('div', { id: 'screener-overlay' });
    document.documentElement.prepend(root);
    return root;
  }

  function showChecking(): void {
    const r = getOverlay();
    r.className = '';
    empty(r);
    r.append(
      el('div', { class: 'so-spinner' }),
      el('div', { class: 'so-title' }, 'Screener is checking this video…'),
      el('div', { class: 'so-subtitle' }, 'Evaluating whether this matches your criteria.'),
    );
  }

  function showBlocked(reason: string | undefined, scheduleName: string, canBypass?: boolean): void {
    const r = getOverlay();
    r.className = '';
    empty(r);
    const reasonText = reason ?? '';
    r.append(
      el('div', { class: 'so-icon' }, '🚫'),
      el('div', { class: 'so-title' }, 'Blocked by Screener'),
      el('div', { class: 'so-subtitle' }, [
        `Schedule: ${scheduleName}`,
        reasonText ? el('br') : '',
        reasonText,
      ].flat()),
    );
    if (canBypass) {
      r.append(
        el('button', { class: 'so-btn secondary', id: 'so-watch-anyway' }, 'Watch anyway'),
        el('div', { class: 'so-countdown-note' }, 'The 5-minute wait starts after you press the button. Leaving this page will reset it.'),
      );
      const btn = $('#so-watch-anyway', r) as HTMLButtonElement | null;
      if (btn) btn.addEventListener('click', () => { setupCountdown(); });
    }
  }

  function showError(message: string, providerInfo: string): void {
    const r = getOverlay();
    r.className = '';
    empty(r);
    r.append(
      el('div', { class: 'so-icon' }, '⚠️'),
      el('div', { class: 'so-title' }, 'Screener couldn\'t check this video'),
      el('div', { class: 'so-subtitle' }, [
        message,
        el('br'),
        el('br'),
        'Check your provider settings in the extension options.',
      ].flat()),
      el('div', { class: 'so-diagnostic' }, providerInfo),
      el('div', { class: 'so-row' }, [
        el('button', { class: 'so-btn primary', id: 'so-retry' }, 'Retry'),
        el('button', { class: 'so-btn secondary', id: 'so-continue' }, 'Continue to video'),
      ]),
    );
    const retryBtn = $('#so-retry', r);
    if (retryBtn) retryBtn.addEventListener('click', () => { currentCheckVideoId = null; doCheck(); });
    const contBtn = $('#so-continue', r);
    if (contBtn) contBtn.addEventListener('click', () => { destroyOverlay(); });
  }

  function destroyOverlay(): void {
    stopCountdown();
    restorePlayback();
    if (root) { root.remove(); root = null; }
  }

  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function showToast(message: string): void {
    if (toastTimer) clearTimeout(toastTimer);
    let toast = document.getElementById('screener-toast');
    if (!toast) {
      toast = el('div', { id: 'screener-toast' }, message);
      document.documentElement.prepend(toast);
    } else {
      toast.textContent = message;
    }
    toast.className = '';
    void toast.offsetWidth;
    toast.className = 'visible';
    toastTimer = setTimeout(() => {
      toast!.className = '';
      toastTimer = null;
      setTimeout(() => { toast?.remove(); }, 300);
    }, 5000);
  }

  // ---------------------------------------------------------------------------
  // Countdown (5 minutes, strict — lost on navigation/close)
  // ---------------------------------------------------------------------------
  let countdownInterval: ReturnType<typeof setInterval> | null = null;
  let countdownSeconds = 5 * 60;

  function updateCountdownLabel(): void {
    const btn = $('#so-watch-anyway') as HTMLButtonElement | null;
    if (!btn) return;
    const m = Math.floor(countdownSeconds / 60);
    const s = countdownSeconds % 60;
    btn.textContent = `Watch anyway (${m}:${String(s).padStart(2, '0')})`;
  }

  function setupCountdown(): void {
    if (countdownInterval) return; // already counting
    countdownSeconds = 5 * 60;
    updateCountdownLabel();
    const btn = $('#so-watch-anyway') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    countdownInterval = setInterval(() => {
      countdownSeconds -= 1;
      updateCountdownLabel();
      if (countdownSeconds <= 0) {
        stopCountdown();
        const videoId = getVideoId();
        if (videoId) {
          chrome.runtime.sendMessage<TempBypassRequest, TempBypassResponse>({ type: MessageType.TempBypass, videoId })
            .catch(() => { /* SW unavailable, bypass local only */ });
        }
        destroyOverlay();
      }
    }, 1000);
  }

  function stopCountdown(): void {
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  }

  // ---------------------------------------------------------------------------
  // Main check flow
  // ---------------------------------------------------------------------------
  let currentCheckVideoId: string | null = null;

  async function doCheck(): Promise<void> {
    const videoId = getVideoId();
    if (!videoId) return;

    // Avoid re-checking the same video during an active session
    if (currentCheckVideoId === videoId && root) return;
    currentCheckVideoId = videoId;

    // Dismiss any previous overlay state immediately — no reason to delay
    // tearing down a stale screen from a different video.
    destroyOverlay();

    let settled = false;
    const sendPromise = chrome.runtime.sendMessage<CheckRequest, CheckResponse>({ type: MessageType.Check, videoId });

    // If the response takes longer than 30 ms the check is almost certainly
    // network-bound (cache miss → oEmbed / AI call), so pause the video and
    // show the checking overlay.  Fast paths (dormant / bypass / cache hit)
    // resolve in well under this window and never interrupt playback.
    const graceTimer = setTimeout(() => {
      void (async () => {
        if (settled || currentCheckVideoId !== videoId) return;
        // Exit fullscreen so the overlay is visible (fullscreen renders in the
        // browser top layer, above any z-index in normal document flow).
        if (document.fullscreenElement) {
          try { await document.exitFullscreen(); } catch { /* ignore */ }
        }
        if (settled || currentCheckVideoId !== videoId) return;
        suppressPlayback();
        showChecking();
      })();
    }, 30);

    try {
      const res = await sendPromise;
      settled = true;
      clearTimeout(graceTimer);
      if (currentCheckVideoId !== videoId) return;
      if (res.type !== MessageType.CheckResult) return;

      if (res.error) {
        if (res.warning) showToast(res.warning);
        suppressPlayback();
        showError(res.error, `${res.scheduleName ?? 'unknown'} / ${res.source}`);
      } else if (res.verdict === 'allow') {
        if (res.warning) showToast(res.warning);
        destroyOverlay();
      } else {
        if (res.warning) showToast(res.warning);
        suppressPlayback();
        showBlocked(res.reason, res.scheduleName ?? 'Unknown', res.canBypass);
      }
    } catch (_e) {
      settled = true;
      clearTimeout(graceTimer);
      // SW may be dead (e.g. extension reloaded mid-check). Fail open.
      if (currentCheckVideoId === videoId) {
        destroyOverlay();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Content scraping (called by the service worker via sendMessage)
  // ---------------------------------------------------------------------------
  function waitForElement(selectors: string[], timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      for (const sel of selectors) {
        const found = $(sel);
        if (found) { resolve(); return; }
      }

      function cleanup(): void {
        clearTimeout(timer);
        obs.disconnect();
      }

      const obs = new MutationObserver(() => {
        for (const sel of selectors) {
          const found = $(sel);
          if (found) { cleanup(); resolve(); return; }
        }
      });

      const timer = setTimeout(() => { cleanup(); resolve(); }, timeoutMs);

      obs.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  function parseTitle(): string {
    const t = document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
    return t || 'Unknown';
  }

  function parseChannel(): string {
    const sel = '#owner #channel-name yt-formatted-string a, ytd-channel-name #text a, #owner yt-formatted-string.ytd-channel-name a';
    const el = $(sel);
    if (el?.textContent) return el.textContent.trim();
    return 'Unknown';
  }

  function parseDescription(): string {
    const sel = '#description-inline-expander yt-attributed-string span, ytd-text-inline-expander yt-formatted-string';
    const el = $(sel);
    if (el?.textContent) return el.textContent.trim();
    return '';
  }

  chrome.runtime.onMessage.addListener((msg: MetadataRequest | DescriptionRequest, _sender, sendResponse) => {
    if (msg.type === MessageType.ScrapeMetadata) {
      const timeoutMs = 3000;
      // Await the page to settle; after document_start the title may still be default.
      void (async () => {
        await waitForElement(['#owner #channel-name yt-formatted-string a', 'ytd-channel-name #text a'], timeoutMs);
        sendResponse({ type: MessageType.ScrapeResult, title: parseTitle(), channel: parseChannel() });
      })();
      return true;
    }
    if (msg.type === MessageType.ScrapeDescription) {
      void (async () => {
        await waitForElement(
          ['#description-inline-expander', 'ytd-text-inline-expander'],
          3000,
        );
        sendResponse({ type: MessageType.DescriptionResult, description: parseDescription() });
      })();
      return true;
    }
    return false;
  });

  // ---------------------------------------------------------------------------
  // SPA navigation detection
  // ---------------------------------------------------------------------------
  function onNavigate(): void {
    const videoId = getVideoId();
    if (videoId && videoId === currentCheckVideoId) return;
    stopCountdown();
    currentCheckVideoId = null;
    destroyOverlay();
    if (isWatchPage()) doCheck();
  }

  // yt-navigate-finish is YouTube's own SPA navigation event.
  // popstate covers browser back/forward.
  document.addEventListener('yt-navigate-finish', () => { onNavigate(); });
  window.addEventListener('popstate', () => onNavigate());

  // If something enters fullscreen while the overlay is showing, re-parent
  // the overlay into that element so it stays visible inside the top layer.
  document.addEventListener('fullscreenchange', () => {
    if (!root) return;
    const target = document.fullscreenElement ?? document.documentElement;
    if (root.parentNode !== target) target.prepend(root);
  });

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  if (isWatchPage()) doCheck();
})();
