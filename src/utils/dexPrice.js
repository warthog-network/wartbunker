import { getNodeData } from './warthogClient.js';

/** Node error when chart endpoints are not registered (common on pre-release builds). */
export const CHART_API_UNSUPPORTED_CODE = 324;

/** Chart candle intervals supported by Warthog node v0.10.16. */
export const CHART_INTERVALS = [
  { id: '5m', label: '5 minutes' },
  { id: '1h', label: '1 hour' },
  { id: '1d', label: '1 day' },
];

const INTERVAL_SECONDS = {
  '5m': 300,
  '1h': 3600,
  '1d': 86400,
};

const WART_DECIMALS = 8;

/** Parse a WART amount object `{ str, E8 }` from the node API. */
export function parseWartAmount(wart) {
  if (!wart) return null;
  if (wart.str != null) {
    const n = parseFloat(wart.str);
    return Number.isFinite(n) ? n : null;
  }
  if (wart.E8 != null) {
    return Number(wart.E8) / 10 ** WART_DECIMALS;
  }
  return null;
}

/** Parse a FundsDecimal `{ str, u64, decimals }` from the node API. */
export function parseFundsDecimalAmount(fd) {
  if (!fd) return null;
  if (fd.str != null) {
    const n = parseFloat(fd.str);
    return Number.isFinite(n) ? n : null;
  }
  if (fd.u64 != null) {
    const decimals = fd.decimals ?? 0;
    return Number(fd.u64) / 10 ** Number(decimals);
  }
  if (fd.E8 != null) {
    return Number(fd.E8) / 10 ** WART_DECIMALS;
  }
  return null;
}

/**
 * Compute pool spot price (WART per 1 asset token) from dex/market liquidityPool reserves.
 * @param {Record<string, unknown>} marketData - MarketDetails from GET /dex/market/:asset
 * @returns {number | null}
 */
export function computePoolSpotPrice(marketData) {
  const pool = marketData?.liquidityPool;
  if (!pool) return null;

  const wart = parseWartAmount(pool.wart);
  const asset = parseFundsDecimalAmount(pool.asset);
  if (wart == null || asset == null || asset <= 0) return null;

  return wart / asset;
}

/** Format a WART-per-asset price for display. */
export function formatAssetPrice(price, maxDecimals = 8) {
  if (price == null || !Number.isFinite(price)) return '—';
  if (price === 0) return '0';
  if (price < 1e-8) return price.toExponential(4);
  const fixed = price.toFixed(maxDecimals);
  return fixed.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1') || '0';
}

/** Normalize a 64-char asset hash (no 0x). */
export function normalizeChartAssetHash(raw) {
  const hash = String(raw || '').trim().replace(/^0x/i, '').toLowerCase();
  if (hash.length !== 64 || !/^[0-9a-f]+$/.test(hash)) {
    return null;
  }
  return hash;
}

/** @typedef {{ timestamp: number, height: number, open: number, high: number, low: number, close: number, baseVol?: number, quoteVol?: number }} CandlePoint */
/** @typedef {{ timestamp: number, height: number, base: number, quote: number, price: number | null }} TradePoint */

/**
 * Parse OHLCV candle tuples from GET /chart/candles/:asset/:interval.
 * @param {unknown} data
 * @returns {CandlePoint[]}
 */
export function parseCandleResponse(data) {
  if (!Array.isArray(data)) return [];

  return data
    .map((row) => {
      if (!Array.isArray(row) || row.length < 6) return null;
      const [timestamp, height, open, high, low, close, baseVol, quoteVol] = row;
      if (![open, high, low, close].every((v) => Number.isFinite(Number(v)))) return null;
      return {
        timestamp: Number(timestamp),
        height: Number(height),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        baseVol: baseVol != null ? Number(baseVol) : undefined,
        quoteVol: quoteVol != null ? Number(quoteVol) : undefined,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Parse trade tuples from GET /chart/trades/:asset.
 * Price = quote / base (WART per asset unit).
 * @param {unknown} data
 * @returns {TradePoint[]}
 */
export function parseTradeResponse(data) {
  if (!Array.isArray(data)) return [];

  return data
    .map((row) => {
      if (!Array.isArray(row) || row.length < 4) return null;
      const [timestamp, height, base, quote] = row;
      const baseN = Number(base);
      const quoteN = Number(quote);
      const price = baseN > 0 && Number.isFinite(quoteN) ? quoteN / baseN : null;
      return {
        timestamp: Number(timestamp),
        height: Number(height),
        base: baseN,
        quote: quoteN,
        price,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Build chart path points from candles (close) or trades (price).
 * @param {CandlePoint[] | TradePoint[]} points
 * @param {'candles' | 'trades'} mode
 * @returns {{ x: number, y: number, label: string, meta: string }[]}
 */
export function toChartSeries(points, mode) {
  return points
    .map((pt) => {
      const price = mode === 'candles' ? pt.close : pt.price;
      if (price == null || !Number.isFinite(price)) return null;
      const date = new Date(pt.timestamp * 1000);
      const label = Number.isFinite(date.getTime())
        ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : `Block ${pt.height}`;
      return {
        x: pt.timestamp,
        y: price,
        label,
        meta: formatAssetPrice(price),
      };
    })
    .filter(Boolean);
}

/** Build node path for chart candles. */
export function buildCandlesPath(assetHash, interval, { n = 200, from, to } = {}) {
  const params = new URLSearchParams();
  if (n != null) params.set('n', String(n));
  if (from != null) params.set('from', String(from));
  if (to != null) params.set('to', String(to));
  const qs = params.toString();
  return `chart/candles/${assetHash}/${interval}${qs ? `?${qs}` : ''}`;
}

/** Build node path for chart trades. */
export function buildTradesPath(assetHash, { n = 200, from, to } = {}) {
  const params = new URLSearchParams();
  if (n != null) params.set('n', String(n));
  if (from != null) params.set('from', String(from));
  if (to != null) params.set('to', String(to));
  const qs = params.toString();
  return `chart/trades/${assetHash}${qs ? `?${qs}` : ''}`;
}

/**
 * Extract trade points from GET /transaction/latest match bodies for one asset.
 * Used when /chart/* endpoints return code 324 on the connected node.
 * @param {unknown} latestData
 * @param {string} assetHash
 * @returns {TradePoint[]}
 */
export function parseMatchTradesFromLatest(latestData, assetHash) {
  const normalized = normalizeChartAssetHash(assetHash);
  if (!normalized) return [];

  const perBlock = latestData?.perBlock;
  if (!Array.isArray(perBlock)) return [];

  const trades = [];
  for (const block of perBlock) {
    const timestamp = Number(
      block?.header?.time?.timestamp ?? block?.header?.timestamp ?? block?.timestamp,
    );
    const height = Number(block?.height);
    if (!Number.isFinite(timestamp) || !Number.isFinite(height)) continue;

    const matches = block?.body?.match;
    if (!Array.isArray(matches)) continue;

    for (const entry of matches) {
      const data = entry?.transaction?.data;
      const baseHash = String(data?.baseAsset?.hash || '').replace(/^0x/i, '').toLowerCase();
      if (baseHash !== normalized) continue;

      const swaps = [...(data?.buySwaps || []), ...(data?.sellSwaps || [])];
      for (const swap of swaps) {
        const swapped = swap?.swapped;
        if (!swapped) continue;
        const baseN = parseFundsDecimalAmount(swapped.base);
        const quoteN = parseWartAmount(swapped.quote);
        if (baseN == null || quoteN == null || baseN <= 0) continue;
        trades.push({
          timestamp,
          height,
          base: baseN,
          quote: quoteN,
          price: quoteN / baseN,
        });
      }
    }
  }

  return trades.sort((a, b) => a.timestamp - b.timestamp || a.height - b.height);
}

/**
 * Bucket trade prices into OHLCV candles (client-side fallback).
 * @param {TradePoint[]} trades
 * @param {string} interval
 * @param {number} [maxN=200]
 * @returns {CandlePoint[]}
 */
export function aggregateTradesToCandles(trades, interval, maxN = 200) {
  const bucketSec = INTERVAL_SECONDS[interval] || INTERVAL_SECONDS['1h'];
  if (!trades.length) return [];

  const buckets = new Map();
  for (const trade of trades) {
    if (trade.price == null || !Number.isFinite(trade.price)) continue;
    const bucketStart = Math.floor(trade.timestamp / bucketSec) * bucketSec;
    let candle = buckets.get(bucketStart);
    if (!candle) {
      candle = {
        timestamp: bucketStart,
        height: trade.height,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        baseVol: trade.base,
        quoteVol: trade.quote,
      };
      buckets.set(bucketStart, candle);
      continue;
    }
    candle.high = Math.max(candle.high, trade.price);
    candle.low = Math.min(candle.low, trade.price);
    candle.close = trade.price;
    candle.height = trade.height;
    candle.baseVol += trade.base;
    candle.quoteVol += trade.quote;
  }

  return [...buckets.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-maxN);
}

/**
 * Build chart points from /transaction/latest when chart API is unavailable.
 * @param {unknown} latestData
 * @param {string} assetHash
 * @param {{ mode: 'candles' | 'trades', interval?: string, n?: number }} options
 * @returns {CandlePoint[] | TradePoint[]}
 */
export function buildPriceHistoryFromLatest(latestData, assetHash, { mode, interval = '1h', n = 200 } = {}) {
  const trades = parseMatchTradesFromLatest(latestData, assetHash);
  if (mode === 'candles') {
    return aggregateTradesToCandles(trades, interval, n);
  }
  return trades.slice(-n);
}

async function getNodeDataWithRetry(api, path, { retries = 1, delayMs = 250 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await getNodeData(api, path);
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

/**
 * Load chart points for an asset from /chart/* (falls back to /transaction/latest).
 * @param {import('warthog-js').WarthogApi} api
 * @param {string} assetHash
 * @param {{ mode?: 'candles' | 'trades', interval?: string, n?: number }} [options]
 * @returns {Promise<{ points: CandlePoint[] | TradePoint[], error: string | null, usedFallback: boolean, mode: 'candles' | 'trades', interval: string }>}
 */
export async function loadAssetPriceChart(api, assetHash, {
  mode = 'candles',
  interval = '1h',
  n = 100,
} = {}) {
  const normalized = normalizeChartAssetHash(assetHash);
  if (!normalized) {
    return { points: [], error: 'Invalid asset hash', usedFallback: false, mode, interval };
  }

  const path = mode === 'candles'
    ? buildCandlesPath(normalized, interval, { n })
    : buildTradesPath(normalized, { n });

  const result = await getNodeDataWithRetry(api, path);

  if (result.code === 0) {
    const points = mode === 'candles'
      ? parseCandleResponse(result.data)
      : parseTradeResponse(result.data);
    return { points, error: null, usedFallback: false, mode, interval };
  }

  if (result.code === CHART_API_UNSUPPORTED_CODE) {
    const latestRes = await getNodeDataWithRetry(api, 'transaction/latest');
    if (latestRes.code !== 0) {
      return {
        points: [],
        error: 'Chart API is not enabled on this node and recent trades could not be loaded.',
        usedFallback: false,
        mode,
        interval,
      };
    }

    const points = buildPriceHistoryFromLatest(latestRes.data, normalized, { mode, interval, n });
    if (!points.length) {
      return {
        points: [],
        error: 'No DEX trades found for this asset in recent blocks.',
        usedFallback: true,
        mode,
        interval,
      };
    }

    return { points, error: null, usedFallback: true, mode, interval };
  }

  return {
    points: [],
    error: result.error || 'Node returned an error',
    usedFallback: false,
    mode,
    interval,
  };
}

/** Serialize chart fetches — parallel asset cards otherwise 502 the proxy. */
let chartFetchQueue = Promise.resolve();
/** Duckdns chart API needs ~10s recovery after a 502 on a no-data asset before the next hash works. */
let chartCooldownUntil = 0;

async function waitChartCooldown() {
  const waitMs = chartCooldownUntil - Date.now();
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

function markChartCooldown(ms = 5000) {
  chartCooldownUntil = Math.max(chartCooldownUntil, Date.now() + ms);
}

function enqueueChartFetch(task, { priority = false } = {}) {
  const run = chartFetchQueue.then(async () => {
    if (!priority) {
      await waitChartCooldown();
    } else {
      // Hash lookups: only wait if a prior 502 cooldown is still active.
      const waitMs = chartCooldownUntil - Date.now();
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    return task();
  });
  chartFetchQueue = run
    .catch(() => {})
    .then(() => new Promise((resolve) => setTimeout(resolve, priority ? 0 : 50)));
  return run;
}

/**
 * Assets with zero DEX pool reserves return 502 from /chart/* and lock out other assets.
 * Skip chart calls for those — saves ~5–10s per no-pool asset in multi-result search.
 */
async function getAssetMarketSnapshot(api, normalized) {
  try {
    const res = await getNodeData(api, `dex/market/${normalized}`);
    if (res.code !== 0) {
      return { hasLiquidity: true, poolSpot: null };
    }
    const pool = res.data?.liquidityPool;
    if (!pool) {
      return { hasLiquidity: false, poolSpot: null };
    }
    const wart = parseWartAmount(pool.wart) ?? 0;
    const asset = parseFundsDecimalAmount(pool.asset) ?? 0;
    return {
      hasLiquidity: wart > 0 && asset > 0,
      poolSpot: asset > 0 ? wart / asset : null,
    };
  } catch {
    return { hasLiquidity: true, poolSpot: null };
  }
}

function dedupeTrades(trades) {
  const seen = new Set();
  return trades.filter((trade) => {
    const key = `${trade.height}-${trade.timestamp}-${trade.price?.toFixed(8)}-${trade.base?.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return trade.price != null && Number.isFinite(trade.price);
  });
}

/**
 * Node /chart/* can lag behind real matches. Merge newer swaps from /transaction/latest
 * and append current pool spot so recent buys show on the chart.
 */
async function augmentChartWithLiveData(api, normalized, result, { n, poolSpot }) {
  if (!result?.points?.length) {
    return { ...result, poolSpot, liveAugment: false };
  }

  let latestRes;
  try {
    latestRes = await getNodeData(api, 'transaction/latest');
  } catch {
    return { ...result, poolSpot, liveAugment: false };
  }

  if (latestRes.code !== 0) {
    return { ...result, poolSpot, liveAugment: false };
  }

  const liveTrades = parseMatchTradesFromLatest(latestRes.data, normalized);
  const chartMaxHeight = Math.max(...result.points.map((p) => p.height ?? 0));
  const chartMaxTs = Math.max(...result.points.map((p) => p.timestamp ?? 0));
  const liveMaxHeight = liveTrades.length
    ? Math.max(...liveTrades.map((t) => t.height ?? 0))
    : chartMaxHeight;
  const hasNewerMatches = liveTrades.some(
    (t) => t.height > chartMaxHeight || t.timestamp > chartMaxTs,
  );

  let points = result.points;
  let mode = result.mode;
  let interval = result.interval;
  let liveAugment = false;

  if (hasNewerMatches) {
    let indexedTrades = result.mode === 'trades'
      ? [...result.points]
      : [];

    if (!indexedTrades.length) {
      const tradesRes = await fetchChartNodeData(api, buildTradesPath(normalized, { n }));
      if (tradesRes.code === 0) {
        indexedTrades = parseTradeResponse(tradesRes.data);
      }
    }

    points = dedupeTrades([...indexedTrades, ...liveTrades])
      .sort((a, b) => a.timestamp - b.timestamp || a.height - b.height)
      .slice(-n);
    mode = 'trades';
    interval = 'trades';
    liveAugment = true;
  }

  if (poolSpot != null && points.length) {
    const last = points[points.length - 1];
    const lastPrice = mode === 'trades' ? last.price : last.close;
    if (
      lastPrice != null
      && Number.isFinite(lastPrice)
      && Math.abs(poolSpot - lastPrice) / Math.max(lastPrice, 1e-12) > 0.005
    ) {
      points = [
        ...points,
        {
          timestamp: Math.max(last.timestamp ?? 0, Math.floor(Date.now() / 1000)),
          height: liveMaxHeight,
          base: 0,
          quote: 0,
          price: poolSpot,
        },
      ];
      if (mode !== 'trades') {
        mode = 'trades';
        interval = 'trades';
      }
      liveAugment = true;
    }
  }

  return {
    ...result,
    points,
    mode,
    interval,
    poolSpot,
    liveAugment,
  };
}

const CHART_GATEWAY_ERROR_PATTERN = /502|bad gateway|html instead of json|non-json/i;

async function fetchChartNodeData(api, path, { retries = 1, delayMs = 300 } = {}) {
  let lastError;
  let sawGatewayError = false;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await getNodeData(api, path);
    } catch (err) {
      lastError = err;
      const message = err?.message || '';
      if (CHART_GATEWAY_ERROR_PATTERN.test(message)) {
        sawGatewayError = true;
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
          continue;
        }
        markChartCooldown();
        return { code: 404, error: 'Chart gateway error', data: null };
      }
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
      }
    }
  }

  if (sawGatewayError) {
    markChartCooldown();
    return { code: 404, error: 'Chart gateway error', data: null };
  }

  throw lastError;
}

async function loadChartAttempt(api, normalized, attempt, { n }) {
  const candleInterval = attempt.interval === 'trades' ? '1h' : attempt.interval;
  const path = attempt.mode === 'candles'
    ? buildCandlesPath(normalized, candleInterval, { n })
    : buildTradesPath(normalized, { n });

  let points = [];
  let usedFallback = false;
  let error = null;

  try {
    const result = await fetchChartNodeData(api, path);

    if (result.code === 0) {
      points = attempt.mode === 'candles'
        ? parseCandleResponse(result.data)
        : parseTradeResponse(result.data);
    } else if (result.code === 404) {
      error = 'Chart gateway error';
    } else if (result.code === CHART_API_UNSUPPORTED_CODE) {
      const latestRes = await fetchChartNodeData(api, 'transaction/latest');
      if (latestRes.code !== 0) {
        error = 'Chart API is not enabled on this node and recent trades could not be loaded.';
      } else {
        points = buildPriceHistoryFromLatest(latestRes.data, normalized, {
          mode: attempt.mode,
          interval: candleInterval,
          n,
        });
        usedFallback = true;
        if (!points.length) {
          error = 'No DEX trades found for this asset in recent blocks.';
        }
      }
    } else {
      error = result.error || 'Node returned an error';
    }
  } catch (err) {
    error = err.message || 'Failed to load chart data';
  }

  if (!points.length) {
    return { points: [], error, usedFallback, mode: attempt.mode, interval: attempt.interval };
  }

  return {
    points,
    error: null,
    usedFallback,
    mode: attempt.mode,
    interval: attempt.interval,
  };
}

async function loadDexStylePriceChartInner(api, assetHash, {
  n = 100,
  mode = 'candles',
  interval = '1h',
  allowFallback = false,
  liveAugment = false,
} = {}) {
  const normalized = normalizeChartAssetHash(assetHash);
  if (!normalized) {
    return {
      points: [],
      error: 'Invalid asset hash',
      usedFallback: false,
      mode,
      interval,
    };
  }

  const { hasLiquidity, poolSpot } = await getAssetMarketSnapshot(api, normalized);
  if (!hasLiquidity) {
    return {
      points: [],
      error: 'No DEX pool liquidity yet — chart appears after the asset has pool trades.',
      usedFallback: false,
      mode,
      interval,
      poolSpot: null,
      liveAugment: false,
    };
  }

  const attempts = allowFallback
    ? [
      { mode: 'candles', interval: '1h' },
      { mode: 'candles', interval: '5m' },
      { mode: 'trades', interval: 'trades' },
    ]
    : [{ mode, interval: mode === 'trades' ? 'trades' : interval }];

  let best = null;

  for (const attempt of attempts) {
    const res = await loadChartAttempt(api, normalized, attempt, { n });

    if (!res.points.length) {
      if (res.error === 'Chart gateway error') {
        break;
      }
      continue;
    }

    if (!best || res.points.length > best.points.length) {
      best = res;
    }

    break;
  }

  if (best?.points?.length) {
    if (liveAugment) {
      return augmentChartWithLiveData(api, normalized, best, { n, poolSpot });
    }
    return { ...best, poolSpot, liveAugment: false };
  }

  return {
    points: [],
    error: 'No DEX price history found for this asset yet.',
    usedFallback: false,
    mode,
    interval,
    poolSpot,
    liveAugment: false,
  };
}

/**
 * Load chart data for embedded asset cards (queued to avoid proxy 502s).
 * Defaults to 1h candles only; pass allowFallback/liveAugment for the old auto behavior.
 */
export function loadDexStylePriceChart(api, assetHash, options = {}) {
  const { priority = false, ...chartOptions } = options;
  return enqueueChartFetch(
    () => loadDexStylePriceChartInner(api, assetHash, chartOptions),
    { priority },
  );
}

/** @deprecated Use loadDexStylePriceChart — kept for any external callers. */
export const loadBestAssetPriceChart = loadDexStylePriceChart;