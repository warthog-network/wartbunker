/**
 * Warthog explorer indexer client (read-only).
 *
 * History + indexed lookups go here; live balance / submit stay on node RPC.
 * See WARTHOG-INDEXER-SETUP / INDEXER-CLIENT-GUIDE.md
 */

import { isDefiNode, DEFI_TESTNET_URL } from './presetNodes.js';
import { normalizeNodeUrl } from './warthogClient.js';
import { isLoopbackNode } from './nodeAccess.js';

/** Public DeFi testnet indexer (nginx → warthog-read-api). */
export const DEFAULT_INDEXER_BASE = `${DEFI_TESTNET_URL.replace(/\/+$/, '')}/api/explorer`;

const PAGE_COUNT_DEFAULT = 50;
const PAGE_COUNT_MAX = 100;

function envIndexerBase() {
  try {
    const raw = import.meta.env?.VITE_WARTHOG_INDEXER_URL;
    if (raw && String(raw).trim()) {
      return String(raw).trim().replace(/\/+$/, '');
    }
  } catch {
    /* no env */
  }
  return null;
}

/**
 * Resolve the explorer indexer base URL for a connected node, or null to use node history.
 * - Explicit VITE_WARTHOG_INDEXER_URL always wins
 * - DeFi / public testnet nodes → public indexer
 * - Loopback custom nodes → no remote indexer (wrong chain risk); use node history
 * - Node already on defitestnet host → same origin /api/explorer
 *
 * @param {string} nodeBase
 * @returns {string|null}
 */
export function resolveIndexerBase(nodeBase) {
  const fromEnv = envIndexerBase();
  if (fromEnv) return fromEnv;

  const node = normalizeNodeUrl(nodeBase);
  if (!node) return null;

  try {
    const u = new URL(node);
    if (u.hostname.toLowerCase().includes('defitestnet')) {
      return `${node.replace(/\/+$/, '')}/api/explorer`;
    }
  } catch {
    /* ignore */
  }

  // Local node = local chain; don't pollute with remote indexer history.
  if (isLoopbackNode(node)) return null;

  if (isDefiNode(node)) {
    return DEFAULT_INDEXER_BASE;
  }

  return null;
}

/** Clean 48-hex address (no 0x). */
export function cleanIndexerAddress(address) {
  return String(address || '')
    .trim()
    .replace(/^0x/i, '')
    .toLowerCase();
}

/**
 * GET JSON from indexer; expects { code, data } envelope (except /health).
 * @param {string} indexerBase
 * @param {string} path path after base, e.g. "/health" or "/accounts/…/transactions?…"
 */
export async function indexerFetch(indexerBase, path) {
  const base = String(indexerBase || '').replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${p}`;
  // Only CORS-safelisted headers. Cache-Control is NOT allowed by the public
  // indexer Access-Control-Allow-Headers (Origin, Content-Type, Accept) — sending
  // it forces a preflight that fails in the browser and drops us to node history.
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Indexer HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * @returns {{ ok: boolean, dbHeight: number|null }}
 */
export async function fetchIndexerHealth(indexerBase) {
  const body = await indexerFetch(indexerBase, '/health');
  // Flat JSON, no code envelope
  if (body && typeof body === 'object' && 'ok' in body) {
    return {
      ok: Boolean(body.ok),
      dbHeight: Number.isFinite(Number(body.dbHeight)) ? Number(body.dbHeight) : null,
    };
  }
  return { ok: false, dbHeight: null };
}

/**
 * Probe whether the indexer supports server-side type/group filters.
 * Caches per base URL for the page lifetime.
 * @type {Map<string, boolean>}
 */
const typeFilterSupportCache = new Map();

/**
 * Sync read of type-filter capability (null = not probed yet).
 * @param {string} indexerBase
 * @returns {boolean|null}
 */
export function getCachedTypeFilterSupport(indexerBase) {
  const base = String(indexerBase || '').replace(/\/+$/, '');
  if (!base || !typeFilterSupportCache.has(base)) return null;
  return typeFilterSupportCache.get(base);
}

/**
 * Mark type-filter support for a base URL (and keep page-lifetime cache).
 * @param {string} indexerBase
 * @param {boolean} supported
 */
export function setTypeFilterSupport(indexerBase, supported) {
  const base = String(indexerBase || '').replace(/\/+$/, '');
  if (!base) return;
  typeFilterSupportCache.set(base, Boolean(supported));
}

/**
 * @param {string} indexerBase
 * @returns {Promise<boolean>}
 */
export async function indexerSupportsTypeFilters(indexerBase) {
  const base = String(indexerBase || '').replace(/\/+$/, '');
  if (!base) return false;
  if (typeFilterSupportCache.has(base)) {
    return typeFilterSupportCache.get(base);
  }
  try {
    const body = await indexerFetch(base, '/meta/tx-types');
    const ok = body?.code === 0 && Array.isArray(body?.data?.types);
    typeFilterSupportCache.set(base, ok);
    return ok;
  } catch {
    // Older indexers: no meta route — require filter echo on a filtered call.
    // Live APIs that ignore group= still return 200 without `data.filter` → false.
    try {
      const probe = await indexerFetch(
        base,
        '/accounts/000000000000000000000000000000000000000000000000/transactions?page=1&count=1&group=reward',
      );
      const hasFilter = probe?.data && Object.prototype.hasOwnProperty.call(probe.data, 'filter');
      typeFilterSupportCache.set(base, Boolean(hasFilter));
      return Boolean(hasFilter);
    } catch {
      typeFilterSupportCache.set(base, false);
      return false;
    }
  }
}

/**
 * Map wallet History filter id → indexer query params.
 * Matches INDEXER-CLIENT-GUIDE “Wallet UI → API mapping”.
 * @param {string} historyFilter  UI id: all|rewards|transfers|…
 * @returns {{ group?: string, direction?: string, type?: string }}
 */
export function historyFilterToIndexerQuery(historyFilter) {
  const id = String(historyFilter || 'all').toLowerCase().replace(/-/g, '_');
  switch (id) {
    case 'all':
      return {};
    case 'rewards':
    case 'reward':
      return { group: 'reward' };
    case 'transfers':
    case 'transfer':
      return { group: 'transfer' };
    case 'limit_swaps':
    case 'limit_swap':
    case 'limitswap':
      return { group: 'limit_swap' };
    case 'matches':
    case 'match':
      return { group: 'match' };
    case 'cancels':
    case 'cancel':
    case 'cancelation':
    case 'cancellation':
      return { group: 'cancelation' };
    case 'asset_creations':
    case 'asset_creation':
    case 'assetcreation':
      return { group: 'asset_creation' };
    case 'liquidity':
      return { group: 'liquidity' };
    case 'in':
      return { direction: 'in' };
    case 'out':
      return { direction: 'out' };
    case 'self':
      return { direction: 'self' };
    default:
      return {};
  }
}

/** True when query params would hit server type/group/direction filters. */
export function isServerHistoryFilter(filter) {
  if (!filter || typeof filter !== 'object') return false;
  return Boolean(filter.group || filter.direction || filter.type || filter.types);
}

/**
 * Page of account transactions from the indexer.
 * @param {string} indexerBase
 * @param {string} address
 * @param {number} [page=1]
 * @param {number} [count=50]
 * @param {{ group?: string, type?: string, types?: string, direction?: string }} [filter]
 * @returns {Promise<{ address: string, page: number, count: number, total: number|null, filter?: object, transactions: object[] }>}
 */
export async function fetchIndexerAccountTransactions(
  indexerBase,
  address,
  page = 1,
  count = PAGE_COUNT_DEFAULT,
  filter = {},
) {
  const addr = cleanIndexerAddress(address);
  if (!/^[0-9a-f]{48}$/.test(addr)) {
    throw new Error('Invalid address for indexer history');
  }
  const p = Math.max(1, Number(page) || 1);
  const c = Math.min(PAGE_COUNT_MAX, Math.max(1, Number(count) || PAGE_COUNT_DEFAULT));
  const qs = new URLSearchParams();
  qs.set('page', String(p));
  qs.set('count', String(c));
  // Prefer group XOR type/types (server rejects both).
  if (filter?.group) {
    qs.set('group', String(filter.group));
  } else if (filter?.types) {
    qs.set('types', String(filter.types));
  } else if (filter?.type) {
    qs.set('type', String(filter.type));
  }
  if (filter?.direction) qs.set('direction', String(filter.direction));
  const path = `/accounts/${addr}/transactions?${qs.toString()}`;
  const body = await indexerFetch(indexerBase, path);
  if (body?.code !== 0) {
    throw new Error(body?.error || 'Indexer history error');
  }
  // Capability cache: successful response with filter echo means type filters live
  if (body?.data && Object.prototype.hasOwnProperty.call(body.data, 'filter')) {
    setTypeFilterSupport(indexerBase, true);
  }
  return body.data;
}

/**
 * Map indexer `type` → wallet UI type keys used by TransactionHistory filters.
 * @param {string} raw
 */
export function mapIndexerTxType(raw) {
  const t = String(raw || '').toLowerCase().replace(/-/g, '_');
  if (!t) return 'unknown';
  if (t === 'reward') return 'reward';
  if (t === 'transfer' || t === 'wart_transfer' || t === 'warttransfer') return 'wart_transfer';
  if (t === 'token_transfer' || t === 'tokentransfer') return 'token_transfer';
  if (t === 'limit_swap' || t === 'limitswap') return 'limit_swap';
  if (t === 'match') return 'match';
  if (t === 'cancelation' || t === 'cancellation' || t.includes('cancel')) return 'cancelation';
  if (t === 'asset_creation' || t === 'assetcreation') return 'asset_creation';
  if (t === 'liquidity_deposit' || t === 'liquiditydeposit') return 'liquidity_deposit';
  if (t === 'liquidity_withdrawal' || t === 'liquiditywithdrawal' || t.includes('liquiditywithdraw')) {
    return 'liquidity_withdrawal';
  }
  return t;
}

function abbreviateAddr(value) {
  const str = String(value || '');
  if (!str || str.length <= 12) return str || 'N/A';
  return `${str.slice(0, 6)}...${str.slice(-4)}`;
}

function isZeroAmount(amount) {
  const s = String(amount ?? '').trim();
  if (!s || s === '0') return true;
  // "0.00000000", "0.0", etc.
  return /^0+(?:\.0+)?$/.test(s);
}

/**
 * Map indexer `meta` onto display fields for history cards.
 * Card detail lives on the explorer indexer (backfilled); no client getBlock hydrate.
 * See docs/WARTBUNKER-INDEXER-RICH-CARDS-CLIENT-GUIDE.md
 * @param {object} out partially normalized tx
 * @param {object|null|undefined} rawMeta raw API meta object
 * @returns {object}
 */
export function applyIndexerMeta(out, rawMeta) {
  const meta = rawMeta && typeof rawMeta === 'object' ? rawMeta : null;
  if (!meta || !out) return out;

  const next = { ...out, meta };

  if (meta.summary) {
    next.description = String(meta.summary);
  }

  if (meta.asset_name) next.assetName = String(meta.asset_name);
  if (meta.asset_hash) next.assetHash = String(meta.asset_hash);
  if (meta.asset_decimals != null) next.assetDecimals = Number(meta.asset_decimals);

  const type = String(next.type || '').toLowerCase();

  if (type === 'limit_swap') {
    if (meta.side) next.side = String(meta.side);
    if (meta.order_amount != null) next.orderAmount = String(meta.order_amount);
    if (meta.limit_price != null) next.limitPrice = String(meta.limit_price);
    // amount is 0 on purpose (not a balance transfer) — show order size on the card
    if (meta.order_amount && isZeroAmount(next.amount)) {
      next.amount = String(meta.order_amount);
      next.asset = meta.side === 'sell'
        ? (meta.asset_name || 'ASSET')
        : 'WART';
    } else if (meta.asset_name && meta.side === 'sell') {
      next.asset = String(meta.asset_name);
    }
    if (!meta.summary) {
      const asset = meta.asset_name || 'ASSET';
      const amt = meta.order_amount || next.amount || '0';
      const lim = meta.limit_price != null ? meta.limit_price : '?';
      next.description = meta.side === 'buy'
        ? `BUY limit ${amt} WART for ${asset} @ ${lim}`
        : meta.side === 'sell'
          ? `SELL limit ${amt} ${asset} @ ${lim}`
          : next.description;
    }
  }

  if (type === 'match') {
    if (meta.base_amount != null) next.baseAmount = String(meta.base_amount);
    if (meta.quote_amount != null) next.quoteAmount = String(meta.quote_amount);
    if (meta.swap_count != null) next.swapCount = Number(meta.swap_count);
    if (meta.base_amount) {
      next.amount = String(meta.base_amount);
      next.asset = meta.asset_name || next.asset || 'ASSET';
      if (meta.quote_amount) {
        next.amountSecondary = `${meta.quote_amount} WART`;
      }
    } else if (meta.asset_name) {
      next.asset = String(meta.asset_name);
    }
    if (!meta.summary) {
      const asset = meta.asset_name || 'ASSET';
      const n = meta.swap_count ?? 0;
      let s = `DEX match${n ? ` (${n} swap${n === 1 ? '' : 's'})` : ''} on ${asset}`;
      if (meta.base_amount && meta.quote_amount) {
        s += ` — ${meta.base_amount} ${asset} / ${meta.quote_amount} WART`;
      }
      next.description = s;
    }
  }

  if (type === 'liquidity_deposit' || type === 'liquidity_withdrawal') {
    if (meta.asset_name) next.asset = String(meta.asset_name);
    if (meta.base_amount != null && meta.quote_amount != null) {
      next.amount = `${meta.base_amount} + ${meta.quote_amount}`;
      next.asset = meta.asset_name ? `${meta.asset_name} / WART` : 'POOL';
    } else if (meta.shares != null && isZeroAmount(next.amount)) {
      next.amount = String(meta.shares);
    }
  }

  if (type === 'token_transfer') {
    if (meta.asset_name) next.asset = String(meta.asset_name);
    if (meta.token_amount != null) next.amount = String(meta.token_amount);
  }

  if (type === 'asset_creation') {
    if (meta.asset_name) next.asset = String(meta.asset_name);
    if (meta.supply != null) next.amount = String(meta.supply);
  }

  if (type === 'cancelation' && meta.cancel_txid && !meta.summary) {
    next.description = `Canceled tx ${abbreviateAddr(meta.cancel_txid)}`;
  }

  return next;
}

/**
 * Normalize one indexer transaction into the shape used by TransactionHistory UI.
 * Prefers server `meta` (summary, asset, order/match legs) when present.
 * @param {object} tx indexer row
 * @param {{ tipHeight?: number|null }} [opts]
 */
export function normalizeIndexerTransaction(tx, opts = {}) {
  const tipHeight = opts.tipHeight ?? null;
  const type = mapIndexerTxType(tx?.type);
  const isReward = type === 'reward';
  const direction = String(tx?.direction || '').toLowerCase();
  const sender = tx?.sender ? String(tx.sender) : '';
  const recipient = tx?.recipient ? String(tx.recipient) : '';
  const amount = tx?.amount != null ? String(tx.amount) : '0';
  const fee = tx?.fee != null ? String(tx.fee) : '0';
  const height = tx?.height != null ? Number(tx.height) : null;
  const timestamp = tx?.timestamp != null ? Number(tx.timestamp) : null;
  const hash = tx?.hash ? String(tx.hash) : 'N/A';

  const isIncoming =
    direction === 'in'
    || isReward
    || type === 'liquidity_withdrawal';

  let asset = 'WART';
  let description = '';
  const hasAmt = !isZeroAmount(amount);

  switch (type) {
    case 'reward':
      description = `Block reward ${amount} WART`;
      break;
    case 'wart_transfer':
      description = isIncoming
        ? `Received ${amount} WART`
        : `Sent ${amount} WART to ${abbreviateAddr(recipient)}`;
      break;
    case 'token_transfer':
      asset = 'TOKEN';
      description = hasAmt
        ? (isIncoming ? `Received ${amount}` : `Sent ${amount}`)
        : (isIncoming ? 'Received token transfer' : 'Sent token transfer');
      break;
    case 'limit_swap':
      // Sparse fallback when meta missing (pre-backfill / other chains).
      description = hasAmt ? `Limit order ${amount}` : 'Limit order placed';
      break;
    case 'match':
      description = hasAmt ? `DEX match ${amount} WART` : 'DEX match';
      break;
    case 'cancelation':
      description = 'Canceled order';
      break;
    case 'liquidity_deposit':
      description = hasAmt ? `Liquidity deposit ${amount}` : 'Liquidity deposit';
      break;
    case 'liquidity_withdrawal':
      description = hasAmt ? `Liquidity withdrawal ${amount}` : 'Liquidity withdrawal';
      break;
    case 'asset_creation':
      description = hasAmt ? `Asset creation ${amount}` : 'Asset creation';
      break;
    default:
      description = type || 'Transaction';
  }

  let confirmations = null;
  if (tipHeight != null && height != null && Number.isFinite(tipHeight) && Number.isFinite(height)) {
    confirmations = Math.max(0, tipHeight - height + 1);
  }

  const base = {
    txid: hash,
    fromAddress: sender || null,
    toAddress: recipient || null,
    amount,
    fee,
    confirmations,
    height,
    timestamp,
    isReward,
    type,
    asset,
    description,
    isIncoming,
    category: type,
    direction: direction || null,
    source: 'indexer',
    meta: null,
    assetName: null,
    assetHash: null,
    amountSecondary: null,
  };

  return applyIndexerMeta(base, tx?.meta);
}

/**
 * Normalize a full page of indexer txs.
 * @param {object[]} transactions
 * @param {{ tipHeight?: number|null }} [opts]
 */
export function normalizeIndexerTransactions(transactions, opts = {}) {
  if (!Array.isArray(transactions)) return [];
  return transactions.map((tx) => normalizeIndexerTransaction(tx, opts));
}
