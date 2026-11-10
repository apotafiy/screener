// Screener feed filter — screens search result cards before the user opens them.
//
// Most screening and queue logic is surface-agnostic, but this module currently
// hardcodes the search surface: /results, ytd-search, search selectors, and the
// search-specific early-block layout. Another surface needs its own adapter.
import type { CardState, ScreenVideoRequest, ScreenVideoResponse } from '../types';
import { EvaluationSource, MessageType } from '../types';
import { parseVideoId } from '../youtube';
// Content-script CSS does not cross into shadow roots, so this same text is
// injected into any open shadow root that hosts feed UI.
import feedCss from '../../public/feed.css?raw';

const MAX_OUTSTANDING = 6;
const CONSECUTIVE_BLOCKS_TO_SHOW = 10;
const CARD_SELECTOR = [
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-rich-grid-media',
  'ytd-reel-item-renderer',
  'yt-lockup-view-model',
  'ytm-shorts-lockup-view-model-v2',
  'ytm-shorts-lockup-view-model',
].join(', ');
const SHELF_SELECTOR = [
  'ytd-shelf-renderer',
  'ytd-horizontal-card-list-renderer',
  'ytd-reel-shelf-renderer',
  'grid-shelf-view-model',
  'ytd-rich-shelf-renderer',
].join(', ');
const SHORTS_ITEM_SELECTOR = [
  'ytm-shorts-lockup-view-model-v2',
  'ytm-shorts-lockup-view-model',
  'ytd-reel-item-renderer',
].join(', ');
const SHORTS_SHELF_SELECTOR = [
  'ytd-reel-shelf-renderer',
  'grid-shelf-view-model',
  'ytd-rich-shelf-renderer',
].join(', ');
const SHORTS_GRID_ITEM_SELECTOR = '.ytGridShelfViewModelGridShelfItem';
const SHELF_TITLE_SELECTOR = '#title, #title-container';

/**
 * Finds a selector in the light tree and any open shadow roots beneath it.
 * YouTube places some thumbnail/title links inside open shadow roots; closed
 * roots cannot be searched, so cards using them are skipped.
 */
function queryDeep<T extends Element>(container: ParentNode, selector: string): T | null {
  const directMatch = container.querySelector<T>(selector);
  if (directMatch) return directMatch;

  if (container instanceof Element && container.shadowRoot) {
    const ownShadowMatch = queryDeep<T>(container.shadowRoot, selector);
    if (ownShadowMatch) return ownShadowMatch;
  }

  for (const childElement of container.querySelectorAll('*')) {
    const childShadow = childElement.shadowRoot;
    if (!childShadow) continue;
    const nestedMatch = queryDeep<T>(childShadow, selector);
    if (nestedMatch) return nestedMatch;
  }
  return null;
}

(() => {
  let screenRunId = 0;
  let outstandingRequests = 0;
  // Null until YouTube mounts ytd-search, which can happen after SPA
  // navigation. The body observer and interval retry until it appears.
  let searchRoot: HTMLElement | null = null;
  let searchRootObserver: MutationObserver | null = null;
  let scanFrameId: number | null = null;
  let scanIntervalId: number | null = null;
  let currentPageKey = '';
  let consecutiveBlocks = 0;
  let earlyBlockElement: HTMLElement | null = null;

  // Card lifecycle:
  // sendQueue         — discovered, not yet sent
  // liveStates        — unresolved states that reset() must finish
  // cardStates        — card element -> live state
  // lastVideoIdByCard — last video id seen on each element
  // blockedVideoIds   — confident blocks that must not advance the streak again
  const sendQueue: CardState[] = [];
  const liveStates = new Set<CardState>();
  const cardStates = new WeakMap<Element, CardState>();
  // YouTube recycles card elements, so element identity is not video identity.
  // Weak keys let detached cards be collected between resets.
  let lastVideoIdByCard = new WeakMap<HTMLElement, string>();
  // A blocked video can reappear on a re-rendered or reused card. Keep the id
  // so every copy is hidden without counting another streak step.
  const blockedVideoIds = new Set<string>();

  // Tracks which cards are near the viewport so pump() screens those first.
  // Pending cards are hidden with visibility, so their layout boxes still
  // exist and can be observed. A YouTube re-render can replace the element,
  // losing visibility tracking until the next scan finds it.
  const cardVisibilityObserver = new IntersectionObserver((visibilityEntries) => {
    for (const visibilityEntry of visibilityEntries) {
      const cardState = cardStates.get(visibilityEntry.target);
      if (cardState) cardState.nearViewport = visibilityEntry.isIntersecting;
    }
    pump();
  }, { rootMargin: '200px' });

  /** True when the current URL is a search results page. */
  function isSearchPage(): boolean {
    return location.pathname.startsWith('/results');
  }

  /** Returns the outermost element to hide for a card host. */
  function cardFor(cardHost: HTMLElement): HTMLElement {
    // Grid/Shorts items can nest renderers. Hide the outermost wrapper so a
    // blocked card does not leave an empty cell, and so nested hosts map to the
    // same element instead of being queued twice.
    return cardHost.closest<HTMLElement>('ytd-rich-item-renderer')
      ?? cardHost.closest<HTMLElement>('ytd-reel-item-renderer')
      ?? cardHost.closest<HTMLElement>('ytd-rich-grid-media')
      // Search Shorts shelves use this light-DOM grid-cell wrapper around the
      // lockup; hiding the lockup alone leaves a sized empty cell.
      ?? cardHost.closest<HTMLElement>(SHORTS_GRID_ITEM_SELECTOR)
      ?? cardHost;
  }

  /** Finds the shelf containing a card, if any. */
  function shelfFor(card: HTMLElement): HTMLElement | null {
    return card.closest<HTMLElement>(SHELF_SELECTOR);
  }

  /** Detects a shelf that contains Shorts cards. */
  function isShortsShelf(shelf: HTMLElement): boolean {
    if (shelf.matches('ytd-reel-shelf-renderer')) return true;
    if (!shelf.matches(SHORTS_SHELF_SELECTOR)) return false;

    const shelfTitle = shelf.querySelector(SHELF_TITLE_SELECTOR)?.textContent?.trim() ?? '';
    if (shelfTitle.toLowerCase() === 'shorts') return true;

    // Search Shorts shelves wrap each lockup in a grid-cell element.
    return !!shelf.querySelector(`${SHORTS_GRID_ITEM_SELECTOR} ${SHORTS_ITEM_SELECTOR}`);
  }

  /** Returns the Shorts shelf containing a card, if any. */
  function shortsShelfFor(card: HTMLElement): HTMLElement | null {
    const shelf = shelfFor(card);
    return shelf && isShortsShelf(shelf) ? shelf : null;
  }

  /** True for direct results and Shorts, false for side shelves. */
  function isDirectResult(card: HTMLElement): boolean {
    // Side shelves such as "Latest from", "Watch again", and "People also
    // search for" are not direct search results. Leave them untouched.
    const shelf = shelfFor(card);
    return !shelf || isShortsShelf(shelf);
  }

  /** Shows or removes the all-Shorts-removed placeholder for a shelf. */
  function updateShortsShelf(card: HTMLElement): void {
    const shelf = shortsShelfFor(card);
    if (!shelf) return;

    // Undo any shelf hiding from older builds.
    shelf.style.removeProperty('display');
    delete shelf.dataset.screenerSectionHidden;

    const shelfCards = new Set<HTMLElement>();
    for (const cardHost of shelf.querySelectorAll<HTMLElement>(CARD_SELECTOR)) {
      shelfCards.add(cardFor(cardHost));
    }
    if (shelfCards.size === 0) return;

    const allBlocked = [...shelfCards].every(
      (shelfCard) => shelfCard.dataset.screenerBlocked === 'true',
    );

    const existingPlaceholder = shelf.querySelector<HTMLElement>('.screener-shorts-placeholder');
    if (!allBlocked) {
      existingPlaceholder?.remove();
      return;
    }

    if (!existingPlaceholder) {
      const shortsPlaceholder = document.createElement('div');
      shortsPlaceholder.className = 'screener-shorts-placeholder';
      shortsPlaceholder.textContent = 'All Shorts were removed by Screener.';
      ensureFeedStyles(shelf);
      const shortsContents = shelf.querySelector('#contents, #items') ?? shelf;
      shortsContents.append(shortsPlaceholder);
    }
  }

  /** Extracts a video id from a card, including links inside shadow roots. */
  function videoIdFor(card: HTMLElement): string | null {
    const videoLink = queryDeep<HTMLAnchorElement>(
      card,
      'a#thumbnail[href], a#video-title[href], a#short-video-title-link[href], a[href*="/watch?v="], a[href*="/shorts/"]',
    );
    // Ads, promos, and continuation placeholders have no video link, and some
    // links are not videos; skip those cards without logging.
    return videoLink ? parseVideoId(videoLink.href) : null;
  }

  /**
   * Injects feed.css into an open shadow root.
   * Content-script CSS does not cross a shadow boundary, so feed UI inside one
   * would otherwise be unstyled. Closed roots cannot be reached.
   */
  function ensureFeedStyles(container: ParentNode | null): void {
    if (!container) return;
    const styleRoot = container.getRootNode();
    if (!(styleRoot instanceof ShadowRoot)) return;
    if (styleRoot.querySelector('style[data-screener-feed]')) return;

    const style = document.createElement('style');
    style.dataset.screenerFeed = '';
    style.textContent = feedCss;
    styleRoot.append(style);
  }

  /** Sizes the early block from the remaining viewport plus a scroll buffer. */
  function fitEarlyBlock(): void {
    if (!earlyBlockElement) return;

    // Desktop YouTube scrolls the window, so scrollHeight/innerHeight describe
    // the page; an inner scroller would need different measurements. Hide the
    // block to measure the page without it, then fill the remaining viewport
    // plus a 50% buffer so the continuation loader stays out of view until the
    // user scrolls.
    earlyBlockElement.style.display = 'none';
    const pageHeight = document.documentElement.scrollHeight;
    const remainingViewport = Math.max(0, window.innerHeight - pageHeight);
    const minimumHeight = Math.round(window.innerHeight);
    const scrollBufferHeight = Math.round(window.innerHeight * 0.5);
    earlyBlockElement.style.display = '';
    const blockHeight = Math.max(remainingViewport + scrollBufferHeight, minimumHeight);
    earlyBlockElement.style.height = `${blockHeight}px`;
  }

  /**
   * Finds the results container. YouTube nests result sections under
   * `ytd-item-section-renderer`; the section list is the older layout. If both
   * disappear, fall back to the search root or body.
   */
  function resultsParent(searchScope: ParentNode): HTMLElement {
    const sectionElements = searchScope.querySelectorAll<HTMLElement>('ytd-item-section-renderer');
    const lastSection = sectionElements[sectionElements.length - 1];
    const sectionList = searchScope.querySelector<HTMLElement>('ytd-section-list-renderer');
    return lastSection?.parentElement
      ?? sectionList?.querySelector<HTMLElement>(':scope > #contents')
      ?? sectionList
      ?? searchRoot
      ?? document.body;
  }

  /** Inserts the early block before an anchor and styles that container. */
  function placeBefore(anchorElement: Element): void {
    if (!earlyBlockElement) return;
    const anchorParent = anchorElement.parentNode;
    if (!anchorParent) return;
    ensureFeedStyles(anchorParent);
    if (earlyBlockElement.nextSibling !== anchorElement) {
      anchorParent.insertBefore(earlyBlockElement, anchorElement);
    }
  }

  /** Places the early block above pending cards or before the continuation loader. */
  function positionEarlyBlock(): void {
    if (!earlyBlockElement) return;

    const searchScope = searchRoot ?? document;

    // Keep the block above cards that are still being screened.
    const pendingCards = searchScope.querySelectorAll<HTMLElement>('.screener-pending-card');
    for (const pendingCard of pendingCards) {
      if (!pendingCard.isConnected) continue;
      const cardState = cardStates.get(pendingCard);
      if (!cardState || cardState.resolved) continue;
      // Do not move a whole Shorts shelf just because one item is pending.
      if (shortsShelfFor(pendingCard)) continue;

      placeBefore(pendingCard);
      return;
    }

    // YouTube appends more results when its continuation item enters view.
    // Keep that item below the block, or scrolling to the bottom never loads.
    const continuationLoader = searchScope.querySelector<HTMLElement>(
      'ytd-continuation-item-renderer',
    );
    if (continuationLoader?.parentElement) {
      placeBefore(continuationLoader);
      return;
    }

    const resultsContainer = resultsParent(searchScope);
    ensureFeedStyles(resultsContainer);
    if (resultsContainer.lastElementChild !== earlyBlockElement) {
      resultsContainer.append(earlyBlockElement);
    }
  }

  /** Repositions and resizes the early block after layout changes. */
  function refreshEarlyBlock(): void {
    if (!earlyBlockElement) return;
    positionEarlyBlock();
    // Wait for the block's new position to lay out before measuring it.
    requestAnimationFrame(fitEarlyBlock);
  }

  /** Creates and inserts the early "very few matches" block. */
  function showEarlyBlock(): void {
    if (earlyBlockElement) return;

    const blockElement = document.createElement('div');
    blockElement.className = 'screener-early-block';
    blockElement.setAttribute('role', 'status');

    const titleElement = document.createElement('div');
    titleElement.className = 'screener-early-title';
    titleElement.textContent = 'Very few matches so far';

    const bodyElement = document.createElement('div');
    bodyElement.className = 'screener-early-body';
    bodyElement.textContent =
      'Try refining your search. Keep scrolling to load more videos, but screening them may use more tokens and cost more.';

    blockElement.append(titleElement, bodyElement);
    earlyBlockElement = blockElement;
    console.info(`Screener: showing early block after ${consecutiveBlocks} consecutive blocks`);
    window.addEventListener('resize', fitEarlyBlock, { passive: true });
    refreshEarlyBlock();
  }

  /** Removes the early block and its resize listener. */
  function clearEarlyBlock(): void {
    earlyBlockElement?.remove();
    earlyBlockElement = null;
    window.removeEventListener('resize', fitEarlyBlock);
  }

  /** Coalesces scans so new cards are hidden before the next paint. */
  function scheduleScan(): void {
    if (scanFrameId !== null) return;
    // requestAnimationFrame runs the callback just before the next paint, so
    // newly appended or re-rendered cards are hidden before they appear.
    scanFrameId = requestAnimationFrame(() => {
      scanFrameId = null;
      scan();
    });
  }

  /**
   * Rescans once a second because the observer cannot see mutations inside
   * shadow roots. It re-reads cards already found in the light tree; it does
   * not discover cards that exist only inside shadow DOM.
   */
  function startInterval(): void {
    if (scanIntervalId === null) {
      scanIntervalId = window.setInterval(() => {
        ensureRoot();
        scheduleScan();
      }, 1000);
    }
  }

  /** Stops the periodic rescan when leaving search. */
  function stopInterval(): void {
    if (scanIntervalId !== null) {
      window.clearInterval(scanIntervalId);
      scanIntervalId = null;
    }
  }

  /** Disconnects the results observer and forgets the search root. */
  function stopRoot(): void {
    searchRootObserver?.disconnect();
    searchRootObserver = null;
    searchRoot = null;
  }

  /**
   * Locates `ytd-search` and observes it. YouTube replaces this root on SPA
   * navigation, so the observer is reattached whenever the current root is
   * gone; if the new root has not mounted yet, the next tick retries.
   */
  function ensureRoot(): void {
    if (!isSearchPage()) {
      stopRoot();
      stopInterval();
      return;
    }
    startInterval();
    if (searchRoot?.isConnected) return;

    const searchRootCandidate = document.querySelector<HTMLElement>('ytd-search');
    if (!searchRootCandidate) return;

    searchRoot = searchRootCandidate;
    searchRootObserver?.disconnect();
    searchRootObserver = new MutationObserver(scheduleScan);
    searchRootObserver.observe(searchRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href'],
    });
    scheduleScan();
  }

  /** Stops observing a card and removes its card-state entry. */
  function stopTrackingCard(state: CardState): void {
    cardVisibilityObserver.unobserve(state.card);
    cardStates.delete(state.card);
  }

  /** Applies the hidden pending state to a card. */
  function markCardPending(card: HTMLElement): void {
    card.classList.add('screener-pending-card');
    card.setAttribute('aria-hidden', 'true');
    card.setAttribute('inert', '');
  }

  /**
   * Hides a card in place. The inline style also covers shadow roots that do
   * not load feed.css, and the data attribute lets feed.css hide it in the
   * light DOM. A re-render can drop both, so scan() re-hides known blocks.
   */
  function hideCard(card: HTMLElement): void {
    ensureFeedStyles(card.parentNode);
    card.classList.remove('screener-pending-card');
    card.removeAttribute('inert');
    card.style.setProperty('display', 'none', 'important');
    card.setAttribute('aria-hidden', 'true');
    card.dataset.screenerBlocked = 'true';
  }

  /** Restores a card hidden during screening. */
  function showCard(card: HTMLElement): void {
    card.style.removeProperty('display');
    card.removeAttribute('aria-hidden');
    card.removeAttribute('inert');
    card.classList.remove('screener-pending-card');
    delete card.dataset.screenerBlocked;
  }

  /** Removes pending UI and applies the card's final visibility. */
  function finishCard(state: CardState, hidden: boolean): void {
    const queueIndex = sendQueue.indexOf(state);
    if (queueIndex !== -1) sendQueue.splice(queueIndex, 1);
    liveStates.delete(state);
    stopTrackingCard(state);
    if (hidden) hideCard(state.card);
    else showCard(state.card);
  }

  /** Marks a card resolved and applies the shared outcome side effects. */
  function applyCardOutcome(state: CardState, hidden: boolean): void {
    state.resolved = true;
    if (hidden) blockedVideoIds.add(state.videoId);
    finishCard(state, hidden);
    updateShortsShelf(state.card);
    refreshEarlyBlock();
  }

  /** Drops a state whose card was detached or recycled without a verdict. */
  function abandonState(state: CardState): void {
    state.resolved = true;
    liveStates.delete(state);
    const queueIndex = sendQueue.indexOf(state);
    if (queueIndex !== -1) sendQueue.splice(queueIndex, 1);
    stopTrackingCard(state);
    lastVideoIdByCard.delete(state.card);
  }

  /**
   * Shows a card for any outcome that is not a confident block: allow, close
   * call, malformed response, or error. Any of those resets the streak.
   */
  function applyVisibleOutcome(state: CardState): void {
    if (state.resolved) return;
    consecutiveBlocks = 0;
    applyCardOutcome(state, false);
  }

  /**
   * Hides a confident block, advances the streak, and shows the early block at
   * the threshold.
   */
  function applyBlockedOutcome(state: CardState): void {
    if (state.resolved) return;
    applyCardOutcome(state, true);
    consecutiveBlocks += 1;
    if (consecutiveBlocks >= CONSECUTIVE_BLOCKS_TO_SHOW) showEarlyBlock();
  }

  /** True only for blocks that should be hidden; close calls stay visible. */
  function isConfidentBlock(response: ScreenVideoResponse): boolean {
    return response.verdict === 'block' && response.lowConfidence !== true;
  }

  /** True when the card still points at the video this check was for. */
  function isCurrentCardVideo(state: CardState): boolean {
    return state.card.isConnected
      && lastVideoIdByCard.get(state.card) === state.videoId
      && videoIdFor(state.card) === state.videoId;
  }

  /** Re-hides an already blocked card after a re-render or reinsert. */
  function rehideBlockedCard(card: HTMLElement): void {
    hideCard(card);
    updateShortsShelf(card);
  }

  /** Re-hides a card whose video id is already blocked. */
  function rehideKnownBlockedCard(card: HTMLElement): void {
    const state = cardStates.get(card);
    if (state && !state.resolved) {
      state.resolved = true;
      finishCard(state, true);
      updateShortsShelf(card);
      return;
    }
    rehideBlockedCard(card);
  }

  /** Starts queued cards up to the limit, near-viewport cards first. */
  function pump(): void {
    // Detached cards cannot be shown and would otherwise hold a request slot.
    for (const state of liveStates) {
      if (!state.card.isConnected) abandonState(state);
    }

    while (outstandingRequests < MAX_OUTSTANDING) {
      let queueIndex = sendQueue.findIndex(
        (state) => !state.resolved && state.screenRunId === screenRunId && state.nearViewport,
      );
      if (queueIndex === -1) {
        queueIndex = sendQueue.findIndex(
          (state) => !state.resolved && state.screenRunId === screenRunId,
        );
      }
      if (queueIndex === -1) return;

      const [state] = sendQueue.splice(queueIndex, 1);
      if (!state) return;
      send(state);
    }
  }

  /** Sends one card to the service worker and applies its verdict. */
  function send(state: CardState): void {
    outstandingRequests += 1;
    void chrome.runtime
      .sendMessage<ScreenVideoRequest, ScreenVideoResponse>({
        type: MessageType.ScreenVideo,
        videoId: state.videoId,
        surface: EvaluationSource.Search,
      })
      .then((response) => {
        if (state.screenRunId !== screenRunId || state.resolved) return;
        if (!isCurrentCardVideo(state)) {
          abandonState(state);
          return;
        }
        if (!response || response.type !== MessageType.ScreenVideoResult) {
          applyVisibleOutcome(state);
          return;
        }
        if (isConfidentBlock(response)) {
          applyBlockedOutcome(state);
        } else {
          applyVisibleOutcome(state);
        }
      })
      .catch(() => {
        if (state.screenRunId !== screenRunId) return;
        if (!isCurrentCardVideo(state)) {
          abandonState(state);
          return;
        }
        applyVisibleOutcome(state);
      })
      .finally(() => {
        if (state.screenRunId !== screenRunId) return;
        outstandingRequests -= 1;
        pump();
      });
  }

  /** Hides a card until its verdict arrives and queues it for screening. */
  function enqueue(card: HTMLElement, videoId: string): void {
    // A recycled card may still carry a previous block's hiding state.
    showCard(card);

    const state: CardState = {
      card,
      videoId,
      screenRunId,
      nearViewport: false,
      resolved: false,
    };

    cardStates.set(card, state);
    liveStates.add(state);
    markCardPending(card);
    updateShortsShelf(card);

    sendQueue.push(state);
    cardVisibilityObserver.observe(card);
    pump();
  }

  /** Finds new direct-result and Shorts cards and queues them. */
  function scan(): void {
    if (!isSearchPage()) return;

    const searchScope = searchRoot ?? document;
    for (const cardHost of searchScope.querySelectorAll<HTMLElement>(CARD_SELECTOR)) {
      const card = cardFor(cardHost);
      if (!card.isConnected) continue;

      if (!isDirectResult(card)) {
        // A reusable card can move into a side shelf. Restore it and drop any
        // state so the shelf stays untouched.
        const state = cardStates.get(card);
        const wasManaged =
          !!state ||
          card.classList.contains('screener-pending-card') ||
          card.dataset.screenerBlocked === 'true';
        if (state) abandonState(state);
        if (wasManaged) showCard(card);
        lastVideoIdByCard.delete(card);
        continue;
      }

      const videoId = videoIdFor(card);
      // No link yet: a recycled card may still be mounting. Keep any previous
      // hiding state; there is nothing to screen until an id appears.
      if (!videoId) continue;

      // Re-rendered or reused copy of a video that is already blocked.
      if (blockedVideoIds.has(videoId)) {
        rehideKnownBlockedCard(card);
        lastVideoIdByCard.set(card, videoId);
        continue;
      }

      const previousVideoId = lastVideoIdByCard.get(card);
      if (previousVideoId === videoId) {
        // Same video: repair the pending hide if YouTube re-rendered the card.
        const state = cardStates.get(card);
        if (state && !state.resolved) markCardPending(card);
        continue;
      }

      if (previousVideoId !== undefined) {
        // YouTube recycled this element for a different video; the old
        // in-flight check no longer describes what is on screen.
        const staleState = cardStates.get(card);
        if (staleState) abandonState(staleState);
      }

      lastVideoIdByCard.set(card, videoId);
      enqueue(card, videoId);
    }
    pump();
    refreshEarlyBlock();
  }

  /** Clears per-search state when the search query or page changes. */
  function reset(): void {
    screenRunId += 1;
    outstandingRequests = 0;
    sendQueue.length = 0;
    consecutiveBlocks = 0;
    clearEarlyBlock();

    for (const state of liveStates) {
      state.resolved = true;
      finishCard(state, false);
    }
    liveStates.clear();

    // Restore pending cards left by an abandoned state. Blocked cards stay
    // hidden until they are re-screened or their results shell is replaced.
    for (const card of document.querySelectorAll<HTMLElement>('.screener-pending-card')) {
      showCard(card);
    }
    document.querySelectorAll('.screener-shorts-placeholder').forEach((node) => node.remove());

    lastVideoIdByCard = new WeakMap<HTMLElement, string>();
    blockedVideoIds.clear();
  }

  /**
   * Handles SPA navigation. YouTube fires `yt-navigate-finish` after the URL
   * changes, but `ytd-search` can mount later; ensureRoot() is retried by the
   * body observer and the interval.
   */
  function onNavigate(): void {
    const pageKey = location.pathname + location.search;
    if (pageKey !== currentPageKey) {
      currentPageKey = pageKey;
      reset();
    }
    if (isSearchPage()) {
      ensureRoot();
      scheduleScan();
    } else {
      stopRoot();
      stopInterval();
    }
  }

  /**
   * Starts observing once the body exists. The body observer stays for the
   * tab's lifetime because YouTube swaps the results shell without a reload.
   */
  function startFeed(): void {
    if (!document.body) return;

    // Clear any DOM left behind by a previous content-script instance.
    reset();

    const bodyMutationObserver = new MutationObserver(ensureRoot);
    bodyMutationObserver.observe(document.body, { childList: true, subtree: true });

    currentPageKey = location.pathname + location.search;
    document.addEventListener('yt-navigate-finish', onNavigate);
    ensureRoot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startFeed, { once: true });
  } else {
    startFeed();
  }
})();
