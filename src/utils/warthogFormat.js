import { ensureBuffer } from './ensureBuffer.js';

const WART_PRECISION = 8;

/** Format a raw integer amount at the given decimal precision. */
export function formatAmountFromRaw(raw, precision) {
  const value = BigInt(raw);
  const divisor = 10n ** BigInt(precision);
  const whole = value / divisor;
  const frac = value % divisor;
  if (precision === 0) return whole.toString();
  return `${whole}.${frac.toString().padStart(precision, '0')}`;
}

/** Format a WART balance object `{ str, E8 }` from the node API. */
export async function formatWartBalance(wartObj) {
  if (!wartObj) return '0.00000000';
  if (wartObj.str) return wartObj.str;
  if (wartObj.E8 !== undefined) {
    await ensureBuffer();
    const { Wart } = await import('warthog-js');
    const wart = Wart.fromE8(BigInt(wartObj.E8));
    if (wart) return formatAmountFromRaw(wart.E8, WART_PRECISION);
  }
  return '0.00000000';
}

/** Format a token balance object from the node API. */
export async function formatTokenBalance(balanceObj, decimals = 8) {
  if (!balanceObj) return '0';
  if (balanceObj.str) return balanceObj.str;

  const raw = balanceObj.u64 ?? balanceObj.E8 ?? balanceObj.amount;
  if (raw !== undefined) {
    return formatAmountFromRaw(raw, decimals);
  }

  return '0';
}

/** Raw integer units from a node amount object (`u64` / `E8` / `amount`). */
export function rawAmountUnits(amountObj) {
  if (!amountObj || typeof amountObj !== 'object') return 0n;
  const raw = amountObj.u64 ?? amountObj.E8 ?? amountObj.amount;
  if (raw === undefined || raw === null || raw === '') return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

/**
 * Normalize node balance containers into total / locked / mempool parts.
 * Accepts `data.balance`, `data.wart`, or a bare amount object.
 */
export function pickBalanceParts(container) {
  if (!container || typeof container !== 'object') {
    return { total: null, locked: null, mempool: null };
  }
  if (container.total != null || container.locked != null || container.mempool != null) {
    return {
      total: container.total ?? null,
      locked: container.locked ?? null,
      mempool: container.mempool ?? null,
    };
  }
  // Bare amount: treat as total free balance
  if (
    container.str != null
    || container.u64 != null
    || container.E8 != null
    || container.amount != null
  ) {
    return { total: container, locked: null, mempool: null };
  }
  return { total: null, locked: null, mempool: null };
}

/**
 * Format total / locked / mempool / available from a node balance container.
 * Available = max(0, total − locked − mempool) in integer units.
 *
 * @param {object|null} container `data.balance` or `data.wart` (or bare amount)
 * @param {{ kind?: 'wart' | 'token', decimals?: number }} [options]
 */
export async function formatBalanceBreakdown(container, options = {}) {
  const kind = options.kind === 'wart' ? 'wart' : 'token';
  const decimals = kind === 'wart'
    ? WART_PRECISION
    : Math.min(Math.max(parseInt(options.decimals, 10) || 8, 0), 18);

  const parts = pickBalanceParts(container);
  const totalRaw = rawAmountUnits(parts.total);
  const lockedRaw = rawAmountUnits(parts.locked);
  const mempoolRaw = rawAmountUnits(parts.mempool);
  let availableRaw = totalRaw - lockedRaw - mempoolRaw;
  if (availableRaw < 0n) availableRaw = 0n;

  const formatOne = async (obj, rawFallback) => {
    if (obj) {
      if (kind === 'wart') return formatWartBalance(obj);
      return formatTokenBalance(obj, decimals);
    }
    return formatAmountFromRaw(rawFallback, decimals);
  };

  const [total, locked, mempool, available] = await Promise.all([
    formatOne(parts.total, totalRaw),
    formatOne(parts.locked, lockedRaw),
    formatOne(parts.mempool, mempoolRaw),
    Promise.resolve(formatAmountFromRaw(availableRaw, decimals)),
  ]);

  const lockedOrPending = lockedRaw + mempoolRaw;

  return {
    total,
    locked,
    mempool,
    available,
    totalRaw,
    lockedRaw,
    mempoolRaw,
    availableRaw,
    lockedOrPending,
    hasLocked: lockedOrPending > 0n,
  };
}

/** True when `amountStr` exceeds free balance (string compare via decimal parse). */
export function amountExceedsAvailable(amountStr, availableStr) {
  const amount = Number(String(amountStr ?? '').trim().replace(',', '.'));
  const available = Number(String(availableStr ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return false;
  if (!Number.isFinite(available)) return false;
  // Small epsilon for float display noise
  return amount > available + 1e-12;
}

/**
 * Human message when an order/send exceeds free balance.
 * @example "Only 279057.82 free; 230470.95 locked in open orders."
 */
export function insufficientFreeBalanceMessage({ available, locked, unit = '' }) {
  const free = String(available ?? '0');
  const lock = String(locked ?? '0');
  const suffix = unit ? ` ${unit}` : '';
  return `Only ${free}${suffix} free; ${lock}${suffix} locked in open orders.`;
}

/** Format a limit order price using warthog-js Price when a hex encoding is available. */
export async function formatLimitPrice(limit, assetDecimals = 8) {
  if (limit == null) return '0.00000000';
  if (typeof limit === 'number') return limit.toFixed(8);
  if (typeof limit === 'string') {
    if (limit.length === 6) {
      return formatLimitPriceFromHex(limit, assetDecimals);
    }
    const asNum = Number(limit);
    return Number.isFinite(asNum) ? asNum.toFixed(8) : limit;
  }
  if (limit.doubleAdjusted != null) {
    return Number(limit.doubleAdjusted).toFixed(8);
  }
  if (limit.hex?.length === 6) {
    return formatLimitPriceFromHex(limit.hex, assetDecimals);
  }
  return '0.00000000';
}

async function formatLimitPriceFromHex(hex, assetDecimals) {
  await ensureBuffer();
  const { Price, TokenPrecision } = await import('warthog-js');
  const price = Price.fromHex(hex);
  if (!price) return '0.00000000';
  const prec = new TokenPrecision(assetDecimals);
  return price.toDoubleAdjusted(prec).toFixed(8);
}

/** Validate a 64-character asset hash. */
export function isValidAssetHash(hash) {
  const clean = (hash || '').trim().toLowerCase();
  return clean.length === 64 && /^[0-9a-f]+$/.test(clean);
}

/** Validate a Warthog address checksum via warthog-js. */
export async function isValidWarthogAddress(address) {
  const result = await validateWarthogAddressInput(address);
  return result.valid === true;
}

/**
 * Validate a Warthog address locally (no node required).
 * Accepts 40-char account IDs (checksum computed) or 48-char full addresses.
 */
export async function validateWarthogAddressInput(address) {
  const clean = (address || '').trim().replace(/^0x/i, '').toLowerCase();

  if (!clean) {
    return { valid: false, error: 'Please enter an address' };
  }

  if (!/^[0-9a-f]+$/.test(clean)) {
    return { valid: false, error: 'Address must contain only hexadecimal characters (0-9, a-f)' };
  }

  await ensureBuffer();
  const { Address } = await import('warthog-js');

  if (clean.length === 40) {
    const derived = Address.fromRaw(clean);
    if (!derived) {
      return { valid: false, error: 'Invalid 40-character account ID' };
    }
    return {
      valid: true,
      format: 'raw',
      accountId: clean,
      fullAddress: derived.hex,
      checksumValid: true,
      message: 'Valid address',
    };
  }

  if (clean.length === 48) {
    if (!Address.validate(clean)) {
      return {
        valid: false,
        error: 'Checksum invalid — one or more characters may be wrong in this 48-character address.',
      };
    }
    return {
      valid: true,
      format: 'full',
      fullAddress: clean,
      accountId: clean.slice(0, 40),
      checksumValid: true,
      message: 'Valid address',
    };
  }

  return {
    valid: false,
    error: `Address must be 40 hex characters (account ID) or 48 hex characters (full address with checksum). You entered ${clean.length}.`,
  };
}

/** Parse a nonce from account data and return the next usable nonce id. */
export async function getNextNonceFromAccount(data) {
  const current = data?.nonceId ?? data?.nonce;
  if (current === undefined) return 0;
  await ensureBuffer();
  const { NonceId } = await import('warthog-js');
  const nonce = NonceId.fromNumber(Number(current));
  if (!nonce) return 0;
  const next = NonceId.fromNumber(nonce.value + 1);
  return next ? next.value : 0;
}