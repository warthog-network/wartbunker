#!/usr/bin/env node
/**
 * CLI wrapper for the DEX volume generator (shared logic in src/utils/dexVolume.js).
 *
 * Usage:
 *   node scripts/generateDexVolume.mjs [--node URL] [--asset HASH] [--rounds N] [--dry-run]
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ensureBuffer } from '../src/utils/ensureBuffer.js';
import {
  buildVolumePlan,
  executeVolumePlan,
  fetchVolumeContext,
  estimateWartRequired,
} from '../src/utils/dexVolume.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_NODE = 'http://65.87.7.86:3002';
const DEFAULT_ASSET = '67be5795d4fc42b1f58784e4c0ffe4d338a6ae23a816ea5fb21b6b3b1d9ea57a';

function parseArgs(argv) {
  const opts = {
    node: DEFAULT_NODE,
    asset: DEFAULT_ASSET,
    rounds: 5,
    dryRun: false,
    buyWart: '1',
    sellAsset: '10',
    basePrice: 0.1,
    priceStep: 0.02,
    strategy: 'both',
    delayMs: 1500,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--node') opts.node = argv[++i];
    else if (arg === '--asset') opts.asset = argv[++i];
    else if (arg === '--rounds') opts.rounds = Number(argv[++i]);
    else if (arg === '--buy-wart') opts.buyWart = argv[++i];
    else if (arg === '--sell-asset') opts.sellAsset = argv[++i];
    else if (arg === '--base-price') opts.basePrice = Number(argv[++i]);
    else if (arg === '--price-step') opts.priceStep = Number(argv[++i]);
    else if (arg === '--strategy') opts.strategy = argv[++i];
    else if (arg === '--delay-ms') opts.delayMs = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/generateDexVolume.mjs [options]

Options:
  --node URL           Testnet node (default: ${DEFAULT_NODE})
  --asset HASH         Asset hash
  --rounds N           Rounds per strategy (default: 5, max 25)
  --strategy MODE      buys | sells | both (default: both)
  --buy-wart AMT       WART per buy order (default: 1)
  --sell-asset AMT     Asset tokens per sell order (default: 10)
  --base-price P       Starting WART-per-asset price (default: 0.1)
  --price-step P       Price increment per round (default: 0.02)
  --delay-ms MS        Pause between submissions (default: 1500)
  --dry-run            Print plan without submitting
`);
      process.exit(0);
    }
  }

  return opts;
}

async function createNodeApi(nodeBase) {
  await ensureBuffer();
  const { WarthogApi } = await import('warthog-js');
  const base = String(nodeBase || '').trim().replace(/\/+$/, '');
  return new WarthogApi(base, { proxyUrl: null });
}

function loadWallet() {
  const path = join(__dirname, '.volume-wallet.json');
  const raw = readFileSync(path, 'utf8');
  const wallet = JSON.parse(raw);
  if (!wallet.privateKey || wallet.privateKey === 'PLACEHOLDER_WILL_BE_SET') {
    throw new Error('Wallet private key missing in scripts/.volume-wallet.json');
  }
  return wallet;
}

async function main() {
  const opts = parseArgs(process.argv);
  const wallet = loadWallet();
  const api = await createNodeApi(opts.node);

  console.log('Volume bot wallet:', wallet.address);
  console.log('Node:', opts.node);

  const ctx = await fetchVolumeContext(api, wallet.address, opts.asset);
  console.log(`\nBalances — WART: ${ctx.balances.wart} | ${ctx.assetName}: ${ctx.balances.asset}`);
  console.log(`Pool — WART: ${ctx.pool.wart} | ${ctx.assetName}: ${ctx.pool.asset}`);
  if (ctx.spotPriceLabel) console.log(`Pool spot: ${ctx.spotPriceLabel} WART/${ctx.assetName}`);
  console.log(`Open orders — buys: ${ctx.openBuys} | sells: ${ctx.openSells}`);

  const plan = await buildVolumePlan({
    rounds: opts.rounds,
    basePrice: opts.basePrice,
    priceStep: opts.priceStep,
    buyWart: opts.buyWart,
    sellAsset: opts.sellAsset,
    strategy: opts.strategy,
    decimals: ctx.decimals,
  });

  const est = estimateWartRequired(plan);
  console.log(`\nPlan (${plan.length} orders, ~${est.total.toFixed(4)} WART + fees):`);
  for (const step of plan) {
    console.log(
      `  #${step.round} ${step.side} ${step.amount} @ ${step.price} WART/${ctx.assetName} (${step.limitHex})`,
    );
  }

  if (opts.dryRun) {
    console.log('\nDry run — no transactions submitted.');
    return;
  }

  if (ctx.balances.wart === '0' || ctx.balances.wart === '?') {
    console.error('\nWallet has no WART.');
    process.exit(1);
  }

  console.log('\nSubmitting orders...');
  const { logs } = await executeVolumePlan({
    api,
    privateKey: wallet.privateKey,
    assetHash: ctx.assetHash,
    plan,
    decimals: ctx.decimals,
    startNonce: 0,
    delayMs: opts.delayMs,
    assetBalance: Number(ctx.balances.asset) || 0,
    onProgress: (log) => {
      const mark = log.status === 'ok' ? '✓' : log.status === 'skipped' ? '○' : '✗';
      console.log(`  ${mark} ${log.side} #${log.round} @ ${log.price}${log.message ? ` — ${log.message}` : ''}`);
    },
  });

  const ok = logs.filter((l) => l.status === 'ok').length;
  console.log(`\nDone — ${ok}/${logs.length} submitted. Check DEX Charts for ${ctx.assetName}.`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});