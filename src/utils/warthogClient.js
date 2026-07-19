import { ensureBuffer } from './ensureBuffer.js';
import { shouldUseNodeProxy } from './nodeAccess.js';
import { createBrowserWarthogApi } from './browserWarthogApi.js';

/** Normalize a node base URL from user input. */
export function normalizeNodeUrl(nodeBase) {
  let normalized = String(nodeBase || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)) {
    normalized = `http://${normalized}`;
  }
  return normalized;
}

/**
 * Create a WarthogApi client for browser use.
 * Loopback nodes on HTTP pages connect directly; everything else uses /api/proxy
 * (required for HTTP nodes when the wallet is served over HTTPS).
 */
export async function createWarthogApi(nodeBase) {
  await ensureBuffer();
  const { WarthogApi } = await import('warthog-js');
  const normalized = normalizeNodeUrl(nodeBase);
  return createBrowserWarthogApi(WarthogApi, normalized, {
    useProxy: shouldUseNodeProxy(normalized),
  });
}

/** Convert WarthogApi result to the `{ code, data, error }` shape UI components expect. */
export function toNodeResponse(result) {
  if (result.success) {
    return { code: 0, data: result.data };
  }
  return { code: result.code, error: result.error };
}

/** Shape a successful submit result for transaction result cards. */
export function formatSubmitResult(data) {
  return toNodeResponse({ success: true, data });
}

/** Shape a failed submit result for transaction result cards. */
export function formatSubmitError(message) {
  const text =
    typeof message === 'string'
      ? message
      : message?.message != null
        ? String(message.message)
        : message != null
          ? String(message)
          : 'Unknown error';
  // Never surface the literal "undefined"/"null" from bad String() coercion.
  if (!text || text === 'undefined' || text === 'null' || text === 'string undefined') {
    return { code: -1, error: 'Transaction failed — check inputs and try again' };
  }
  return { code: -1, error: text };
}

/** GET a node path and return the legacy `{ code, data, error }` response shape. */
export async function getNodeData(api, path) {
  return toNodeResponse(await api.getNodePath(path));
}

/** POST to transaction/add (or another path) and return the legacy response shape. */
export async function postNodeData(api, path, body) {
  const normalized = path.replace(/^\//, '');
  if (normalized === 'transaction/add') {
    return toNodeResponse(await api.submitTransaction(body));
  }
  throw new Error(`Unsupported POST path: ${path}`);
}

/** Parse a 40- or 48-char recipient address. */
export function parseRecipientAddress(Address, raw) {
  const trimmed = raw.trim().replace(/^0x/i, '');
  return Address.fromHex(trimmed) ?? Address.fromRaw(trimmed);
}

/** Normalize an asset hash to lowercase 64-char hex (no 0x). */
export function normalizeAssetHash(raw) {
  return raw.trim().replace(/^0x/i, '').toLowerCase();
}

/** Preferred transaction fee when the node's minimum is lower. */
export const DEFAULT_TX_FEE = '0.01';

/** Human-readable WART amount from raw E8. */
export function formatFeeE8(e8) {
  try {
    const n = Number(e8) / 1e8;
    return Number.isFinite(n) ? n.toFixed(8).replace(/\.?0+$/, '') : null;
  } catch {
    return null;
  }
}

/** Display string for the node's current minimum fee. */
export function formatNodeMinFee(minFeeData) {
  return minFeeData?.str || formatFeeE8(minFeeData?.E8) || 'unknown';
}

/**
 * Effective default fee: max(preferred DEFAULT_TX_FEE, node minimum), after compact-fee rounding.
 * @param {{ E8: string | number | bigint, str?: string }} minFeeData
 */
export async function computeSuggestedTxFee(minFeeData) {
  const { Wart, RoundedFee } = await import('warthog-js');
  const nodeMin = RoundedFee.fromE8(BigInt(minFeeData.E8), true);
  const preferred = Wart.parse(DEFAULT_TX_FEE)?.roundedFee(true);
  const chosen = preferred && preferred.E8 >= nodeMin.E8 ? preferred : nodeMin;

  if (chosen.E8 === nodeMin.E8 && minFeeData.str) {
    return minFeeData.str;
  }
  return formatFeeE8(chosen.E8) || DEFAULT_TX_FEE;
}

/** Fetch live min/suggested fees from the connected node. */
export async function fetchNodeTxFees(api) {
  const feeRes = await api.getMinFee();
  if (!feeRes.success) {
    throw new Error(feeRes.error || 'Could not fetch minimum fee');
  }
  const minFee = feeRes.data.minFee;
  return {
    minFee,
    minFeeStr: formatNodeMinFee(minFee),
    suggestedFeeStr: await computeSuggestedTxFee(minFee),
  };
}

/**
 * Parse and validate a fee against the node minimum.
 * @param {string} [feeInput]
 * @param {{ E8: string | number | bigint, str?: string }} minFeeData
 */
export async function resolveTxFee(feeInput, minFeeData) {
  const { Wart } = await import('warthog-js');
  const feeStr = String(feeInput ?? '').trim().replace(',', '.');

  if (!feeStr) {
    const suggestedStr = await computeSuggestedTxFee(minFeeData);
    const suggested = Wart.parse(suggestedStr)?.roundedFee(true);
    if (!suggested) {
      throw new Error(`Invalid suggested fee "${suggestedStr}"`);
    }
    return { fee: suggested, feeE8: String(suggested.E8) };
  }

  const wartFee = Wart.parse(feeStr);
  if (!wartFee) {
    throw new Error(`Invalid fee amount "${feeStr}" (use WART units, e.g. ${DEFAULT_TX_FEE})`);
  }

  const fee = wartFee.roundedFee(true);
  const minFeeE8 = BigInt(minFeeData.E8);
  if (fee.E8 < minFeeE8) {
    const minStr = formatNodeMinFee(minFeeData);
    throw new Error(`Fee must be at least ${minStr} WART (you entered ${feeStr})`);
  }

  return { fee, feeE8: String(fee.E8) };
}

/**
 * Fetch fee + chain pin, sign a tx, and submit via WarthogApi.
 * Prefer `buildSpec` (signing worker). `privateKey` + `buildTx` remain as legacy fallback.
 * @returns {{ nonce: number, data: unknown }}
 */
export async function signAndSubmitTransaction(api, { privateKey, nonceId, buildTx, buildSpec, fee: feeInput }) {
  const { Account, NonceId, normalizeChainPin } = await import('warthog-js');

  const feeRes = await api.getMinFee();
  if (!feeRes.success) {
    throw new Error(feeRes.error || 'Could not fetch minimum fee');
  }

  const { fee, feeE8 } = await resolveTxFee(feeInput, feeRes.data.minFee);

  const nonce = NonceId.fromNumber(nonceId);
  if (!nonce) {
    throw new Error('Invalid nonce');
  }

  let tx;
  if (buildSpec) {
    const headRes = await api.getChainHead();
    if (!headRes.success) {
      throw new Error(headRes.error || 'Failed to fetch chain head');
    }
    const { pinHash, pinHeight } = normalizeChainPin(headRes.data);
    const { buildTransactionInWorker } = await import('./signingBridge.js');
    tx = await buildTransactionInWorker(
      {
        pinHash,
        pinHeight,
        feeE8,
        nonceId,
      },
      buildSpec,
    );
  } else if (privateKey && buildTx) {
    const ctx = await api.createTransactionContext(fee, nonce);
    const account = Account.fromPrivateKeyHex(privateKey);
    tx = await buildTx(ctx, account);
  } else {
    throw new Error('Wallet is locked — unlock to sign transactions');
  }

  const submitResult = await api.submitTransaction(tx);

  if (!submitResult.success) {
    throw new Error(submitResult.error || 'Node rejected transaction');
  }

  return { nonce: nonce.value, data: submitResult.data };
}

/**
 * Fetch full block payloads for history pages (timestamps + authoritative bodies).
 * @returns {{ timestampMap: Record<number, unknown>, fullBlockMap: Record<number, unknown> }}
 */
export async function fetchBlockDetails(api, perBlock) {
  if (!perBlock?.length) {
    return { timestampMap: {}, fullBlockMap: {} };
  }

  const responses = await Promise.allSettled(
    perBlock.map((block) => api.getBlock(block.height)),
  );

  const timestampMap = {};
  const fullBlockMap = {};

  responses.forEach((res, idx) => {
    if (res.status === 'fulfilled' && res.value.success) {
      const b = res.value.data;
      const h = perBlock[idx].height;
      timestampMap[h] = b?.header?.time?.timestamp || b?.timestamp || b?.header?.time;
      fullBlockMap[h] = b;
    }
  });

  return { timestampMap, fullBlockMap };
}