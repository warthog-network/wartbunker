import { ensureBuffer } from './ensureBuffer.js';
import { isLocalNode } from './nodeAccess.js';
import { createBrowserWarthogApi } from './browserWarthogApi.js';

/** Normalize a node base URL from user input. */
export function normalizeNodeUrl(nodeBase) {
  return String(nodeBase || '').trim().replace(/\/+$/, '');
}

/**
 * Create a WarthogApi client for browser use.
 * Local/LAN nodes connect directly from the user's browser.
 * Remote nodes use a JSON POST proxy (required for HTTP nodes on HTTPS production).
 */
export async function createWarthogApi(nodeBase) {
  await ensureBuffer();
  const { WarthogApi } = await import('warthog-js');
  const normalized = normalizeNodeUrl(nodeBase);
  return createBrowserWarthogApi(WarthogApi, normalized, {
    useProxy: !isLocalNode(normalized),
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
  return { code: -1, error: message };
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

/**
 * Fetch fee + chain pin, sign a tx, and submit via WarthogApi.
 * @returns {{ nonce: number, data: unknown }}
 */
export async function signAndSubmitTransaction(api, { privateKey, nonceId, buildTx }) {
  const { Account, NonceId, RoundedFee } = await import('warthog-js');

  const feeRes = await api.getMinFee();
  if (!feeRes.success) {
    throw new Error(feeRes.error || 'Could not fetch minimum fee');
  }

  const fee = RoundedFee.fromE8(BigInt(feeRes.data.minFee.E8), true);
  if (!fee) {
    throw new Error('Invalid fee from node');
  }

  const nonce = NonceId.fromNumber(nonceId);
  if (!nonce) {
    throw new Error('Invalid nonce');
  }

  const ctx = await api.createTransactionContext(fee, nonce);
  const account = Account.fromPrivateKeyHex(privateKey);
  const tx = await buildTx(ctx, account);
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