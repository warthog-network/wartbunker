import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ensureBuffer } from './ensureBuffer.js';
import { signAndSubmitTransaction } from './warthogClient.js';
import { executeBuildSpec } from './txBuildHandlers.js';
import { encodeLimitPriceHex } from './encodeLimitPrice.js';
import { computePoolSpotPrice, formatAssetPrice, normalizeChartAssetHash } from './dexPrice.js';
import { parseWartBalance, parseAssetBalance } from './dexVolume.js';
import { DEFI_TESTNET_URL, PRESET_NODES } from './presetNodes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WALLET_PATH = join(__dirname, '../../scripts/.volume-wallet.json');

/** Prefer official, then remaining presets (same order as the wallet UI). */
export const DEFAULT_NODES = [
  DEFI_TESTNET_URL,
  ...PRESET_NODES.map((n) => n.url).filter((url) => url !== DEFI_TESTNET_URL),
];

/** Create a direct WarthogApi client (CLI / bot — no browser proxy). */
export async function createBotApi(nodeBase) {
  await ensureBuffer();
  const { WarthogApi } = await import('warthog-js');
  const base = String(nodeBase || '').trim().replace(/\/+$/, '');
  return new WarthogApi(base, { proxyUrl: null });
}

/** Try nodes in order until one responds to a lightweight health check. */
export async function pickWorkingNode(nodes = DEFAULT_NODES) {
  for (const node of nodes) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const api = await createBotApi(node);
        const head = await api.getChainHead();
        if (head.success) return { api, node };
      } catch {
        await sleep(800);
      }
    }
  }
  throw new Error('No testnet node reachable');
}

export function loadBotWallet(path = WALLET_PATH) {
  const wallet = JSON.parse(readFileSync(path, 'utf8'));
  if (!wallet.privateKey || wallet.privateKey === 'PLACEHOLDER_WILL_BE_SET') {
    throw new Error('Bot wallet private key missing — restore scripts/.volume-wallet.json');
  }
  return wallet;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Next nonce = highest used nonce in account history + 1. */
export async function getNextNonceFromHistory(api, address) {
  const hist = await api.getAccountHistory(address);
  if (!hist.success) {
    throw new Error(hist.error || 'Could not fetch account history');
  }

  let maxNonce = -1;
  for (const block of hist.data?.perBlock || []) {
    const body = block.body || {};
    for (const key of Object.keys(body)) {
      const val = body[key];
      const items = Array.isArray(val) ? val : val ? [val] : [];
      for (const item of items) {
        const n = item?.transaction?.signedCommon?.nonceId;
        if (n != null && Number(n) > maxNonce) maxNonce = Number(n);
      }
    }
  }

  return maxNonce + 1;
}

/** List all assets with non-empty DEX pools. */
export async function scanTradeableMarkets(api) {
  const list = await api.getNodePath('asset/complete?namePrefix=');
  if (!list.success) {
    throw new Error(list.error || 'Could not list assets');
  }

  const assets = list.data?.matches || [];
  const markets = [];

  for (const asset of assets) {
    const hash = normalizeChartAssetHash(asset.hash);
    if (!hash) continue;

    const marketRes = await api.getNodePath(`dex/market/${hash}`);
    if (!marketRes.success) continue;

    const poolWart = Number(marketRes.data?.liquidityPool?.wart?.str || 0);
    const poolAsset = Number(marketRes.data?.liquidityPool?.asset?.str || 0);
    if (poolWart <= 0 || poolAsset <= 0) continue;

    const spot = computePoolSpotPrice(marketRes.data);
    markets.push({
      name: asset.name ?? marketRes.data?.baseAsset?.name ?? 'ASSET',
      hash,
      decimals: asset.decimals ?? marketRes.data?.baseAsset?.decimals ?? 8,
      poolWart: marketRes.data.liquidityPool.wart.str,
      poolAsset: marketRes.data.liquidityPool.asset.str,
      spotPrice: spot,
      spotLabel: spot != null ? formatAssetPrice(spot) : null,
      openBuys: marketRes.data?.wartToAssetSwaps?.length ?? 0,
      openSells: marketRes.data?.assetToWartSwaps?.length ?? 0,
    });
  }

  return markets.sort((a, b) => Number(b.poolWart) - Number(a.poolWart));
}

/** Wallet WART + per-asset balances for tradeable markets. */
export async function fetchBotBalances(api, address, markets) {
  const wartRes = await api.getNodePath(`account/${address}/wart_balance`);
  const balances = {
    wart: wartRes.success ? parseWartBalance(wartRes.data) : '?',
    wartLocked: wartRes.data?.wart?.locked?.str ?? '0',
    assets: {},
  };

  for (const m of markets) {
    const res = await api.getNodePath(`account/${address}/balance/asset:${m.hash}`);
    balances.assets[m.name] = res.success ? parseAssetBalance(res.data) : '0';
  }

  return balances;
}

/**
 * Place a limit swap (buy = spend WART for asset, sell = spend asset for WART).
 * @param {'buy'|'sell'} side
 * @param {number} limitPrice - WART per asset token
 */
export async function submitLimitSwap({
  api,
  privateKey,
  assetHash,
  side,
  amount,
  limitPrice,
  decimals = 8,
  nonceId,
}) {
  const limitHex = await encodeLimitPriceHex(String(limitPrice), decimals, {
    ceil: side === 'buy',
  });

  const { nonce, data } = await signAndSubmitTransaction(api, {
    privateKey,
    nonceId,
    buildTx: async (ctx, account) =>
      executeBuildSpec(ctx, account, {
        type: 'LIMIT_SWAP',
        assetHash,
        isBuy: side === 'buy',
        amount: String(amount),
        assetDecimals: decimals,
        limitHex,
      }),
  });

  const txHash = data?.txHash || data?.hash || null;
  return { nonce, txHash, limitHex, data };
}

/** Buy asset from pool: limit price at/above spot. */
export async function buyFromPool({
  api,
  privateKey,
  market,
  wartAmount,
  nonceId,
  priceMultiplier = 1.05,
}) {
  if (market.spotPrice == null || market.spotPrice <= 0) {
    throw new Error(`No spot price for ${market.name}`);
  }
  const limitPrice = market.spotPrice * priceMultiplier;

  return submitLimitSwap({
    api,
    privateKey,
    assetHash: market.hash,
    side: 'buy',
    amount: wartAmount,
    limitPrice,
    decimals: market.decimals,
    nonceId,
  });
}

/** Sell asset into pool: limit price at/below spot. */
export async function sellToPool({
  api,
  privateKey,
  market,
  assetAmount,
  nonceId,
  priceMultiplier = 0.95,
}) {
  if (market.spotPrice == null || market.spotPrice <= 0) {
    throw new Error(`No spot price for ${market.name}`);
  }
  const limitPrice = market.spotPrice * priceMultiplier;

  return submitLimitSwap({
    api,
    privateKey,
    assetHash: market.hash,
    side: 'sell',
    amount: assetAmount,
    limitPrice,
    decimals: market.decimals,
    nonceId,
  });
}

export function findMarketByName(markets, nameOrPrefix) {
  const q = String(nameOrPrefix).trim().toUpperCase();
  return (
    markets.find((m) => m.name.toUpperCase() === q)
    || markets.find((m) => m.name.toUpperCase().startsWith(q))
    || markets.find((m) => m.hash.startsWith(q.toLowerCase()))
  );
}