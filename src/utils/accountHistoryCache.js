/**
 * Account-history cache.
 *
 * Indexer path (preferred): demand-driven pages — same idea as the explorer UI
 * (fetch page N when needed). No multi-thousand-tx background scan.
 *
 * Node path (fallback): background cursor scan (slow RPC; prefetch still helps).
 */

import { createWarthogApi, fetchBlockDetails, normalizeNodeUrl } from './warthogClient.js';
import { parseHistoryBlocks } from './accountHistoryParse.js';
import {
  resolveIndexerBase,
  fetchIndexerHealth,
  fetchIndexerAccountTransactions,
  normalizeIndexerTransactions,
  indexerSupportsTypeFilters,
  historyFilterToIndexerQuery,
  getCachedTypeFilterSupport,
  isServerHistoryFilter,
} from './warthogIndexer.js';

const NODE_INITIAL_CURSOR = '4294967295';
const NODE_BG_PAGE_DELAY_MS = 450;
const NODE_UI_PAGE_DELAY_MS = 80;
/**
 * Indexer page size (API default 25, max 100).
 * 50 balances tab first-paint with fewer round-trips on heavy miners.
 */
const INDEXER_PAGE_COUNT = 50;
/** Initial warm pages on connect/open (explorer-like first paint). */
const INDEXER_WARM_PAGES = 1;
/** Default pages per demand-driven loadMore when server already filtered. */
const INDEXER_MAX_PAGES_PER_LOAD = 4;
/**
 * Parallel page fetches only for legacy client-side filter hunts
 * (indexer without type/group/direction). Prefer server filters when available.
 */
const INDEXER_FILTER_CONCURRENCY = 8;
/** Pages per legacy filter-hunt burst (fallback only). */
const INDEXER_FILTER_MAX_PAGES = 40;
const MAX_NODE_BACKGROUND_PAGES = 800;

export { INDEXER_FILTER_CONCURRENCY, INDEXER_FILTER_MAX_PAGES, INDEXER_PAGE_COUNT };

/** @type {Map<string, HistoryEntry>} */
const entries = new Map();
/** @type {Set<(key: string) => void>} */
const listeners = new Set();

/**
 * @typedef {object} HistoryEntry
 * @property {string} key
 * @property {string} address
 * @property {string} node
 * @property {string} filterLane  UI filter id when server type filters used; else 'all'
 * @property {object} serverFilter  indexer query { group?, direction? }
 * @property {boolean|null} typeFiltersSupported
 * @property {string|null} indexerBase
 * @property {'indexer'|'node'|null} source
 * @property {any[]} items
 * @property {string|null} nextCursor
 * @property {number} nextPage
 * @property {boolean} hasMore
 * @property {boolean} loading
 * @property {boolean} scanning true while a fetch is in flight (indexer) or node pump running
 * @property {string|null} error
 * @property {number} pages
 * @property {number} generation
 * @property {boolean} uiPriority
 * @property {number|null} tipHeight
 * @property {Promise<void>|null} pumpPromise node background pump
 * @property {Promise<void>|null} loadPromise indexer demand load
 */

function normalizeFilterLane(filter) {
  const f = String(filter || 'all').toLowerCase();
  return f || 'all';
}

function cacheKey(address, node, filter = 'all') {
  const a = String(address || '').trim().toLowerCase().replace(/^0x/i, '');
  const n = normalizeNodeUrl(node);
  const f = normalizeFilterLane(filter);
  return `${n}::${a}::${f}`;
}

function buildSnapshot(entry) {
  return {
    key: entry.key,
    address: entry.address,
    node: entry.node,
    filterLane: entry.filterLane,
    serverFilter: entry.serverFilter,
    typeFiltersSupported: entry.typeFiltersSupported,
    indexerBase: entry.indexerBase,
    source: entry.source,
    items: entry.items,
    nextCursor: entry.nextCursor,
    nextPage: entry.nextPage,
    hasMore: entry.hasMore,
    loading: entry.loading,
    scanning: entry.scanning,
    error: entry.error,
    pages: entry.pages,
    generation: entry.generation,
    uiPriority: entry.uiPriority,
    tipHeight: entry.tipHeight,
  };
}

function emptyEntry(key, address, node, filter = 'all') {
  const filterLane = normalizeFilterLane(filter);
  const indexerBase = resolveIndexerBase(node);
  const cachedSupport = getCachedTypeFilterSupport(indexerBase);
  const serverFilter = historyFilterToIndexerQuery(filterLane);
  const entry = {
    key,
    address,
    node: normalizeNodeUrl(node),
    filterLane,
    serverFilter,
    // Seed from page-lifetime probe so filter lanes skip a second meta call
    typeFiltersSupported: cachedSupport,
    indexerBase,
    source: null,
    items: [],
    nextCursor: NODE_INITIAL_CURSOR,
    nextPage: 1,
    hasMore: true,
    loading: false,
    scanning: false,
    error: null,
    pages: 0,
    generation: 0,
    uiPriority: false,
    tipHeight: null,
    pumpPromise: null,
    loadPromise: null,
    initPromise: null,
    snapshot: null,
  };
  // Without server filters, non-all lanes only make sense as client hunts on 'all'
  if (entry.typeFiltersSupported === false && entry.filterLane !== 'all') {
    entry.serverFilter = {};
  }
  entry.snapshot = buildSnapshot(entry);
  return entry;
}

/** Stamp typeFiltersSupported on every cache entry that shares this indexer base. */
function propagateTypeFilterSupport(indexerBase, supported) {
  const base = String(indexerBase || '').replace(/\/+$/, '');
  if (!base) return;
  entries.forEach((entry) => {
    if (entry.indexerBase !== base) return;
    if (entry.typeFiltersSupported === supported) return;
    entry.typeFiltersSupported = supported;
    if (!supported && entry.filterLane !== 'all') {
      entry.serverFilter = {};
    } else if (supported && entry.filterLane !== 'all') {
      entry.serverFilter = historyFilterToIndexerQuery(entry.filterLane);
    }
    touch(entry);
    notify(entry.key);
  });
}

function touch(entry) {
  entry.snapshot = buildSnapshot(entry);
}

function notify(key) {
  listeners.forEach((fn) => {
    try {
      fn(key);
    } catch (err) {
      console.warn('[history-cache] listener error', err);
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} address
 * @param {string} node
 * @param {string} [filter='all']
 * @returns {ReturnType<typeof buildSnapshot> | null}
 */
export function getHistorySnapshot(address, node, filter = 'all') {
  if (!address || !node) return null;
  const entry = entries.get(cacheKey(address, node, filter));
  if (!entry) return null;
  return entry.snapshot;
}

export function subscribeHistory(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Speeds remaining *node* background pages when History UI is open.
 */
export function setHistoryUiPriority(address, node, active, filter = 'all') {
  if (!address || !node) return;
  const entry = entries.get(cacheKey(address, node, filter));
  if (!entry) return;
  const next = Boolean(active);
  if (entry.uiPriority === next) return;
  entry.uiPriority = next;
  touch(entry);
  notify(entry.key);
}

/**
 * Warm cache for a filter lane: indexer → first page; node → background pump.
 * @param {string} address
 * @param {string} node
 * @param {string} [filter='all']
 */
export function ensureHistoryPrefetch(address, node, filter = 'all') {
  if (!address || !node) return null;
  const key = cacheKey(address, node, filter);
  let entry = entries.get(key);
  if (!entry) {
    entry = emptyEntry(key, address, node, filter);
    entries.set(key, entry);
  }

  if (entry.pages === 0 && !entry.initPromise && !entry.loadPromise && !entry.pumpPromise) {
    entry.initPromise = bootstrapEntry(entry).finally(() => {
      if (entries.get(key) === entry) entry.initPromise = null;
    });
  }

  return getHistorySnapshot(address, node, filter);
}

function requestSatisfied(entry, opts) {
  if (opts.minLoaded != null && entry.items.length >= opts.minLoaded) return true;
  if (opts.untilMatchCount != null && opts.matchFn) {
    if (countMatches(entry, opts.matchFn) >= opts.untilMatchCount) return true;
  }
  return false;
}

/**
 * Demand-load more history.
 * Indexer: fetch next page(s) until stop condition or budget.
 * Node: ensure background pump is running (already continuous).
 *
 * @param {string} address
 * @param {string} node
 * @param {{ filter?: string, minLoaded?: number, untilMatchCount?: number, matchFn?: (tx: any) => boolean, maxPages?: number, concurrency?: number }} [opts]
 */
export function loadMoreHistory(address, node, opts = {}) {
  if (!address || !node) return Promise.resolve();
  const filter = normalizeFilterLane(opts.filter || 'all');
  const key = cacheKey(address, node, filter);
  let entry = entries.get(key);
  if (!entry) {
    entry = emptyEntry(key, address, node, filter);
    entries.set(key, entry);
  }

  // Wait for initial bootstrap if still running
  if (entry.initPromise) {
    return entry.initPromise.then(() => loadMoreHistory(address, node, opts));
  }

  if (entry.source === 'node' || (!entry.source && !entry.indexerBase)) {
    // Node path relies on continuous pump (only on 'all' lane)
    if (!entry.pumpPromise && entry.pages === 0) {
      entry.initPromise = bootstrapEntry(entry).finally(() => {
        if (entries.get(key) === entry) entry.initPromise = null;
      });
      return entry.initPromise;
    }
    return entry.pumpPromise || Promise.resolve();
  }

  if (requestSatisfied(entry, opts)) return Promise.resolve();
  if (!entry.hasMore && entry.pages > 0) return Promise.resolve();

  // Coalesce concurrent demand loads
  if (entry.loadPromise) {
    return entry.loadPromise.then(() => loadMoreHistory(address, node, opts));
  }

  entry.loadPromise = (async () => {
    try {
      await ensureSource(entry);
      if (entry.source !== 'indexer') {
        if (!entry.pumpPromise) {
          entry.pumpPromise = runNodePump(entry).finally(() => {
            if (entries.get(key) === entry) entry.pumpPromise = null;
          });
        }
        return;
      }
      if (requestSatisfied(entry, opts) || !entry.hasMore) return;
      await loadIndexerPages(entry, opts);
    } finally {
      if (entries.get(key) === entry) {
        entry.loadPromise = null;
      }
    }
  })();

  return entry.loadPromise;
}

/**
 * Drop and re-warm a filter lane (or all lanes for this address+node when filter omitted).
 * @param {string} address
 * @param {string} node
 * @param {string} [filter]  if set, only that lane; if omitted, all lanes for addr+node
 */
export function refreshHistoryPrefetch(address, node, filter) {
  if (!address || !node) return;
  const n = normalizeNodeUrl(node);
  const a = String(address || '').trim().toLowerCase().replace(/^0x/i, '');
  const prefix = `${n}::${a}::`;

  const targets = [];
  if (filter != null && filter !== '') {
    targets.push(normalizeFilterLane(filter));
  } else {
    entries.forEach((entry, key) => {
      if (key.startsWith(prefix)) targets.push(entry.filterLane);
    });
    if (targets.length === 0) targets.push('all');
  }

  for (const lane of targets) {
    const key = cacheKey(address, node, lane);
    const prev = entries.get(key);
    if (prev) {
      prev.generation += 1;
      prev.scanning = false;
      prev.hasMore = false;
    }
    const entry = emptyEntry(key, address, node, lane);
    entry.generation = (prev?.generation || 0) + 1;
    entries.set(key, entry);
    touch(entry);
    notify(key);
    entry.initPromise = bootstrapEntry(entry).finally(() => {
      if (entries.get(key) === entry) entry.initPromise = null;
    });
  }
}

export function clearHistoryPrefetch() {
  entries.forEach((entry) => {
    entry.generation += 1;
    entry.scanning = false;
    entry.hasMore = false;
  });
  entries.clear();
  notify('*');
}

function mergeItems(entry, newItems) {
  const seen = new Set(entry.items.map((x) => x.txid));
  const fresh = newItems.filter((it) => {
    if (!it.txid || it.txid === 'N/A' || seen.has(it.txid)) return false;
    seen.add(it.txid);
    return true;
  });
  entry.items = entry.items.concat(fresh);
  return fresh.length;
}

function countMatches(entry, matchFn) {
  if (!matchFn) return entry.items.length;
  let n = 0;
  for (const tx of entry.items) {
    if (matchFn(tx)) n += 1;
  }
  return n;
}

function shouldStopLoad(entry, opts) {
  if (!entry.hasMore) return true;
  if (opts.minLoaded != null && entry.items.length >= opts.minLoaded) return true;
  if (opts.untilMatchCount != null && opts.matchFn) {
    if (countMatches(entry, opts.matchFn) >= opts.untilMatchCount) return true;
  }
  return false;
}

async function ensureSource(entry) {
  if (entry.source) return entry.source;
  const gen = entry.generation;

  if (entry.indexerBase) {
    try {
      const health = await fetchIndexerHealth(entry.indexerBase);
      if (gen !== entry.generation) return null;
      if (health.ok) {
        entry.source = 'indexer';
        entry.tipHeight = health.dbHeight;
        // Detect server-side type filters (meta/tx-types or filter echo)
        if (entry.typeFiltersSupported == null) {
          try {
            entry.typeFiltersSupported = await indexerSupportsTypeFilters(entry.indexerBase);
          } catch {
            entry.typeFiltersSupported = false;
          }
          propagateTypeFilterSupport(entry.indexerBase, entry.typeFiltersSupported);
        }
        // Without server filters, non-all lanes would be empty hunts — fall back to all+client
        if (!entry.typeFiltersSupported && entry.filterLane !== 'all') {
          entry.serverFilter = {};
        } else if (entry.typeFiltersSupported && entry.filterLane !== 'all') {
          entry.serverFilter = historyFilterToIndexerQuery(entry.filterLane);
        }
        touch(entry);
        notify(entry.key);
        return 'indexer';
      }
      console.warn(
        '[history-cache] indexer health not ok, falling back to node',
        entry.indexerBase,
      );
    } catch (err) {
      console.warn(
        '[history-cache] indexer unavailable, falling back to node',
        entry.indexerBase,
        err?.message || err,
      );
    }
  }

  if (gen !== entry.generation) return null;
  entry.source = 'node';
  // Keep indexerBase so a later refresh can retry the indexer after a transient failure
  entry.typeFiltersSupported = false;
  touch(entry);
  notify(entry.key);
  return 'node';
}

async function bootstrapEntry(entry) {
  const key = entry.key;
  const gen = entry.generation;
  entry.loading = true;
  entry.scanning = true;
  entry.error = null;
  touch(entry);
  notify(key);

  try {
    const source = await ensureSource(entry);
    if (gen !== entry.generation) return;

    if (source === 'indexer') {
      await loadIndexerPages(entry, {
        maxPages: INDEXER_WARM_PAGES,
        minLoaded: INDEXER_PAGE_COUNT * INDEXER_WARM_PAGES,
      });
    } else if (source === 'node') {
      if (!entry.pumpPromise) {
        entry.pumpPromise = runNodePump(entry).finally(() => {
          if (entries.get(key) === entry) entry.pumpPromise = null;
        });
      }
      await entry.pumpPromise;
    }
  } finally {
    if (gen === entry.generation) {
      entry.loading = false;
      if (entry.source === 'indexer') {
        entry.scanning = false;
      }
      touch(entry);
      notify(key);
    }
  }
}

/**
 * Fall back to node history after a hard indexer failure on first page.
 */
async function fallbackToNodeHistory(entry) {
  entry.source = 'node';
  // Keep indexerBase for diagnostics / future retry via refresh
  entry.error = null;
  entry.hasMore = true;
  entry.nextCursor = NODE_INITIAL_CURSOR;
  entry.pages = 0;
  entry.items = [];
  entry.scanning = false;
  entry.loading = false;
  entry.typeFiltersSupported = false;
  touch(entry);
  notify(entry.key);
  if (!entry.pumpPromise) {
    entry.pumpPromise = runNodePump(entry).finally(() => {
      if (entries.get(entry.key) === entry) entry.pumpPromise = null;
    });
  }
  await entry.pumpPromise;
}

/**
 * Fetch one or more indexer pages under a budget / stop condition.
 * Server-filtered lanes: sequential pages (each page is already the sparse tab).
 * Legacy (no type filters): optional parallel bursts for client-side hunting.
 */
async function loadIndexerPages(entry, opts = {}) {
  const gen = entry.generation;
  const useServerFilter = Boolean(
    entry.typeFiltersSupported && isServerHistoryFilter(entry.serverFilter),
  );
  const maxPages = Math.max(1, opts.maxPages ?? INDEXER_MAX_PAGES_PER_LOAD);
  // Parallel only when client is hunting sparse types on an unfiltered feed
  const defaultConcurrency = useServerFilter ? 1 : (opts.concurrency ?? 1);
  const concurrency = Math.max(1, Math.min(12, opts.concurrency ?? defaultConcurrency));

  if (gen !== entry.generation) return;
  if (!entry.hasMore && entry.pages > 0) return;

  entry.scanning = true;
  if (entry.pages === 0) entry.loading = true;
  entry.error = null;
  touch(entry);
  notify(entry.key);

  let pagesThisCall = 0;

  try {
    // Tip once at start of a load (not every page)
    try {
      const health = await fetchIndexerHealth(entry.indexerBase);
      if (gen !== entry.generation) return;
      if (health.ok && health.dbHeight != null) {
        entry.tipHeight = health.dbHeight;
      }
    } catch {
      /* keep previous tip */
    }

    while (
      gen === entry.generation
      && entry.hasMore
      && pagesThisCall < maxPages
      && !shouldStopLoad(entry, opts)
    ) {
      const batchSize = Math.min(concurrency, maxPages - pagesThisCall);
      const startPage = entry.nextPage;
      const pageNums = Array.from({ length: batchSize }, (_, i) => startPage + i);
      const queryFilter = useServerFilter ? entry.serverFilter : {};

      let results;
      try {
        results = await Promise.all(
          pageNums.map(async (page) => {
            const data = await fetchIndexerAccountTransactions(
              entry.indexerBase,
              entry.address,
              page,
              INDEXER_PAGE_COUNT,
              queryFilter,
            );
            return { page, data };
          }),
        );
      } catch (err) {
        if (gen !== entry.generation) return;
        if (entry.pages === 0) {
          console.warn('[history-cache] indexer page failed, falling back to node', err?.message || err);
          await fallbackToNodeHistory(entry);
          return;
        }
        entry.error = err?.message || 'Failed to load history from indexer';
        entry.hasMore = false;
        break;
      }

      if (gen !== entry.generation) return;

      // Apply in ascending page order; absorb the sequential prefix we already paid for
      results.sort((a, b) => a.page - b.page);

      for (const { page, data } of results) {
        if (page !== entry.nextPage) continue;

        // Learn capability mid-flight if filter echo appears
        if (data && Object.prototype.hasOwnProperty.call(data, 'filter') && !entry.typeFiltersSupported) {
          entry.typeFiltersSupported = true;
          propagateTypeFilterSupport(entry.indexerBase, true);
        }

        const txs = Array.isArray(data?.transactions) ? data.transactions : [];
        const normalized = normalizeIndexerTransactions(txs, { tipHeight: entry.tipHeight });
        mergeItems(entry, normalized);

        entry.pages += 1;
        entry.nextPage = page + 1;
        pagesThisCall += 1;

        if (txs.length < INDEXER_PAGE_COUNT) {
          entry.hasMore = false;
          // Later parallel pages are past end-of-history — ignore them
          break;
        }
      }

      touch(entry);
      notify(entry.key);

      if (entry.loading && entry.pages > 0) {
        entry.loading = false;
        touch(entry);
        notify(entry.key);
      }
    }
  } finally {
    if (gen === entry.generation) {
      entry.loading = false;
      entry.scanning = false;
      touch(entry);
      notify(entry.key);
    }
  }
}

async function fetchOneNodePage(entry) {
  const gen = entry.generation;
  const isFirst = entry.pages === 0;
  if (isFirst) entry.loading = true;
  entry.scanning = true;
  entry.error = null;
  touch(entry);
  notify(entry.key);

  try {
    const api = await createWarthogApi(entry.node);
    if (gen !== entry.generation) return;

    const cursor = entry.nextCursor ?? NODE_INITIAL_CURSOR;
    const histRes = await api.getAccountHistory(entry.address, cursor);
    if (gen !== entry.generation) return;

    if (!histRes.success) {
      if (isFirst) {
        entry.items = [];
        entry.hasMore = false;
        entry.nextCursor = null;
        entry.error = histRes.error || 'Failed to fetch transaction history';
      } else {
        entry.hasMore = false;
        entry.nextCursor = null;
      }
      return;
    }

    const rawData = histRes.data;
    if (!rawData?.perBlock || !Array.isArray(rawData.perBlock)) {
      entry.hasMore = false;
      entry.nextCursor = null;
      if (isFirst) entry.error = 'Unexpected response format from history endpoint';
      return;
    }

    const { timestampMap, fullBlockMap } = await fetchBlockDetails(api, rawData.perBlock);
    if (gen !== entry.generation) return;

    const newItems = parseHistoryBlocks(rawData, timestampMap, fullBlockMap, entry.address);
    mergeItems(entry, newItems);

    entry.pages += 1;
    entry.nextCursor = rawData.fromId > 0 ? String(rawData.fromId) : null;
    entry.hasMore = rawData.fromId > 0 && entry.pages < MAX_NODE_BACKGROUND_PAGES;
    if (entry.pages >= MAX_NODE_BACKGROUND_PAGES) {
      entry.hasMore = false;
    }
  } catch (err) {
    if (gen !== entry.generation) return;
    console.error('[history-cache]', err);
    entry.error = err?.message || 'Failed to load history';
    entry.hasMore = entry.pages > 0 ? false : false;
  } finally {
    if (gen === entry.generation) {
      entry.loading = false;
      touch(entry);
      notify(entry.key);
    }
  }
}

async function runNodePump(entry) {
  const gen = entry.generation;
  entry.scanning = true;
  touch(entry);
  notify(entry.key);

  while (gen === entry.generation && entry.hasMore && entry.pages < MAX_NODE_BACKGROUND_PAGES) {
    await fetchOneNodePage(entry);
    if (gen !== entry.generation) return;
    if (!entry.hasMore) break;
    const delay = entry.uiPriority ? NODE_UI_PAGE_DELAY_MS : NODE_BG_PAGE_DELAY_MS;
    await sleep(delay);
  }

  if (gen === entry.generation) {
    entry.scanning = false;
    entry.loading = false;
    touch(entry);
    notify(entry.key);
  }
}
