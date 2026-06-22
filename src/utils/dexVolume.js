import { buildLimitSwapTx } from './buildDexTx.js';
import { encodeLimitPriceHex } from './encodeLimitPrice.js';
import { signAndSubmitTransaction } from './warthogClient.js';
import { computePoolSpotPrice, formatAssetPrice, normalizeChartAssetHash } from './dexPrice.js';

const DEFAULT_DELAY_MS = 1500;
const MAX_ROUNDS = 25;

/** @typedef {'buys' | 'sells' | 'both'} VolumeStrategy */

/**
 * @typedef {Object} VolumePlanStep
 * @property {number} round
 * @property {number} price
 * @property {string} limitHex
 * @property {'buy' | 'sell'} side
 * @property {string} amount
 */

/**
 * @typedef {Object} VolumeExecutionLog
 * @property {number} round
 * @property {'buy' | 'sell'} side
 * @property {number} price
 * @property {'ok' | 'skipped' | 'failed'} status
 * @property {string} [message]
 * @property {number} [nonce]
 */

export function clampRounds(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 5;
  return Math.min(MAX_ROUNDS, Math.max(1, Math.round(v)));
}

export function parseWartBalance(data) {
  return data?.wart?.total?.str ?? data?.balance?.str ?? '0';
}

export function parseAssetBalance(data) {
  return data?.balance?.total?.str ?? data?.balance?.str ?? data?.str ?? '0';
}

/** Load wallet balances + market snapshot for the volume tool. */
export async function fetchVolumeContext(api, address, assetHash) {
  const normalized = normalizeChartAssetHash(assetHash);
  if (!normalized) {
    throw new Error('Asset hash must be exactly 64 hex characters');
  }

  const [wartRes, assetRes, marketRes] = await Promise.all([
    api.getNodePath(`account/${address}/wart_balance`),
    api.getNodePath(`account/${address}/balance/asset:${normalized}`),
    api.getNodePath(`dex/market/${normalized}`),
  ]);

  if (!marketRes.success) {
    throw new Error(marketRes.error || 'Could not fetch market');
  }

  const market = marketRes.data;
  const assetName = market?.baseAsset?.name ?? 'ASSET';
  const decimals = market?.baseAsset?.decimals ?? 8;
  const poolWart = market?.liquidityPool?.wart?.str ?? '0';
  const poolAsset = market?.liquidityPool?.asset?.str ?? '0';
  const spotPrice = computePoolSpotPrice(market);

  return {
    assetHash: normalized,
    assetName,
    decimals,
    balances: {
      wart: wartRes.success ? parseWartBalance(wartRes.data) : '?',
      asset: assetRes.success ? parseAssetBalance(assetRes.data) : '?',
    },
    pool: { wart: poolWart, asset: poolAsset },
    spotPrice,
    spotPriceLabel: spotPrice != null ? formatAssetPrice(spotPrice) : null,
    openBuys: market?.wartToAssetSwaps?.length ?? 0,
    openSells: market?.assetToWartSwaps?.length ?? 0,
    market,
  };
}

/**
 * Build a sequence of limit orders for DEX volume generation.
 * @param {Object} options
 * @param {number} options.rounds
 * @param {number} options.basePrice - WART per asset
 * @param {number} options.priceStep
 * @param {string} options.buyWart
 * @param {string} options.sellAsset
 * @param {VolumeStrategy} options.strategy
 * @param {number} [options.decimals=8]
 * @returns {Promise<VolumePlanStep[]>}
 */
export async function buildVolumePlan({
  rounds,
  basePrice,
  priceStep,
  buyWart,
  sellAsset,
  strategy = 'both',
  decimals = 8,
}) {
  const n = clampRounds(rounds);
  const base = Number(basePrice);
  const step = Number(priceStep);
  if (!Number.isFinite(base) || base <= 0) {
    throw new Error('Base price must be greater than 0');
  }
  if (!Number.isFinite(step) || step < 0) {
    throw new Error('Price step must be 0 or greater');
  }

  const plan = [];
  for (let i = 0; i < n; i++) {
    const price = base + i * step;
    const limitHex = await encodeLimitPriceHex(String(price), decimals);

    if (strategy === 'buys' || strategy === 'both') {
      plan.push({
        round: i + 1,
        price,
        limitHex,
        side: 'buy',
        amount: String(buyWart).trim(),
      });
    }
    if (strategy === 'sells' || strategy === 'both') {
      plan.push({
        round: i + 1,
        price,
        limitHex,
        side: 'sell',
        amount: String(sellAsset).trim(),
      });
    }
  }

  return plan;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Submit limit orders from a volume plan.
 * @param {Object} options
 * @param {import('warthog-js').WarthogApi} options.api
 * @param {string} options.privateKey
 * @param {string} options.assetHash
 * @param {VolumePlanStep[]} options.plan
 * @param {number} options.decimals
 * @param {number} [options.startNonce]
 * @param {number} [options.delayMs]
 * @param {boolean} [options.skipSellsWithoutAsset=true]
 * @param {number} [options.assetBalance=0]
 * @param {(log: VolumeExecutionLog) => void} [options.onProgress]
 */
export async function executeVolumePlan({
  api,
  privateKey,
  assetHash,
  plan,
  decimals,
  startNonce = 0,
  delayMs = DEFAULT_DELAY_MS,
  skipSellsWithoutAsset = true,
  assetBalance = 0,
  onProgress,
}) {
  let nonce = Math.max(Number(startNonce) || 0, 0);
  const logs = [];
  const hasAsset = Number(assetBalance) > 0;

  for (const step of plan) {
    if (step.side === 'sell' && skipSellsWithoutAsset && !hasAsset) {
      const entry = {
        round: step.round,
        side: step.side,
        price: step.price,
        status: 'skipped',
        message: 'No asset balance — buy against the pool first or fund the wallet',
      };
      logs.push(entry);
      onProgress?.(entry);
      continue;
    }

    try {
      const { nonce: usedNonce } = await signAndSubmitTransaction(api, {
        privateKey,
        nonceId: nonce,
        buildTx: (ctx, account) => buildLimitSwapTx(ctx, account, {
          assetHash,
          isBuy: step.side === 'buy',
          amount: step.amount,
          assetDecimals: decimals,
          limitHex: step.limitHex,
        }),
      });

      const entry = {
        round: step.round,
        side: step.side,
        price: step.price,
        status: 'ok',
        nonce: usedNonce,
      };
      logs.push(entry);
      onProgress?.(entry);
      nonce = usedNonce + 1;
      if (delayMs > 0) await sleep(delayMs);
    } catch (err) {
      const entry = {
        round: step.round,
        side: step.side,
        price: step.price,
        status: 'failed',
        message: err.message || 'Unknown error',
      };
      logs.push(entry);
      onProgress?.(entry);
    }
  }

  return { logs, nextNonce: nonce };
}

/** Estimate WART needed for a buy-only or both-sides plan (rough, excludes fees). */
export function estimateWartRequired(plan, feePerTx = 0.02) {
  const buySteps = plan.filter((s) => s.side === 'buy');
  const buyTotal = buySteps.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const feeTotal = plan.length * feePerTx;
  return { buyTotal, feeTotal, total: buyTotal + feeTotal, orderCount: plan.length };
}

/**
 * Human-readable summary for a volume-run confirmation step.
 * @param {VolumePlanStep[]} plan
 * @param {{ assetBalance?: number, assetName?: string, feePerTx?: number }} [options]
 */
export function summarizeVolumePlan(plan, { assetBalance = 0, assetName = 'ASSET', feePerTx = 0.02 } = {}) {
  const buySteps = plan.filter((s) => s.side === 'buy');
  const sellSteps = plan.filter((s) => s.side === 'sell');
  const hasAsset = Number(assetBalance) > 0;
  const sellsToSubmit = hasAsset ? sellSteps.length : 0;
  const sellsSkipped = hasAsset ? 0 : sellSteps.length;
  const estimate = estimateWartRequired(plan, feePerTx);
  const assetCommitted = sellSteps
    .slice(0, sellsToSubmit)
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

  return {
    ...estimate,
    assetName,
    buyCount: buySteps.length,
    sellCount: sellSteps.length,
    submitCount: buySteps.length + sellsToSubmit,
    sellsSkipped,
    assetCommitted,
  };
}