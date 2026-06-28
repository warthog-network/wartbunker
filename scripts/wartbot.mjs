#!/usr/bin/env node
/**
 * Wartbot — scan DeFi testnet DEX pools and trade WART for assets (and back).
 *
 * Usage:
 *   node scripts/wartbot.mjs scan
 *   node scripts/wartbot.mjs balances
 *   node scripts/wartbot.mjs buy MHJ --wart 1
 *   node scripts/wartbot.mjs sell BUN --amount 1
 *   node scripts/wartbot.mjs probe   # small round-trip test trades
 */

import {
  pickWorkingNode,
  loadBotWallet,
  scanTradeableMarkets,
  fetchBotBalances,
  getNextNonceFromHistory,
  findMarketByName,
  buyFromPool,
  sellToPool,
} from '../src/utils/wartbot.js';

function parseArgs(argv) {
  const cmd = argv[2] || 'help';
  const opts = { node: null, wart: null, amount: null, asset: null };

  for (let i = 3; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--node') opts.node = argv[++i];
    else if (arg === '--wart') opts.wart = argv[++i];
    else if (arg === '--amount') opts.amount = argv[++i];
    else if (!opts.asset && !arg.startsWith('--')) opts.asset = arg;
  }

  return { cmd, opts };
}

function printHelp() {
  console.log(`Wartbot — Warthog DeFi testnet trader

Commands:
  scan                 List pools with liquidity
  balances             Show bot wallet balances
  buy <ASSET> --wart N Spend N WART to buy asset (pool limit buy)
  sell <ASSET> --amount N  Sell N asset tokens for WART
  probe                Try small buy MHJ + sell 1 BUN

Options:
  --node URL           Force a specific testnet node
`);
}

async function main() {
  const { cmd, opts } = parseArgs(process.argv);
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  const wallet = loadBotWallet();
  const { api, node } = opts.node
    ? { api: await (await import('../src/utils/wartbot.js')).createBotApi(opts.node), node: opts.node }
    : await pickWorkingNode();

  console.log('Wartbot wallet:', wallet.address);
  console.log('Node:', node);

  const markets = await scanTradeableMarkets(api);

  if (cmd === 'scan') {
    console.log(`\nTradeable pools (${markets.length}):`);
    for (const m of markets) {
      console.log(
        `  ${m.name.padEnd(6)} spot ${m.spotLabel ?? '?'} WART/token`
        + `  pool ${m.poolWart} WART / ${m.poolAsset} ${m.name}`
        + `  orders ${m.openBuys}b/${m.openSells}s`,
      );
      console.log(`         ${m.hash}`);
    }
    return;
  }

  const balances = await fetchBotBalances(api, wallet.address, markets);

  if (cmd === 'balances') {
    console.log(`\nWART: ${balances.wart} (locked: ${balances.wartLocked})`);
    for (const m of markets) {
      console.log(`  ${m.name}: ${balances.assets[m.name] ?? '0'}`);
    }
    return;
  }

  let nonce = await getNextNonceFromHistory(api, wallet.address);
  console.log('Next nonce:', nonce);

  if (cmd === 'buy') {
    const market = findMarketByName(markets, opts.asset);
    if (!market) throw new Error(`Unknown or illiquid asset: ${opts.asset}`);
    const wart = opts.wart || '1';
    console.log(`\nBuying ${market.name} with ${wart} WART @ ~${market.spotLabel} (+5% limit)...`);
    const res = await buyFromPool({
      api,
      privateKey: wallet.privateKey,
      market,
      wartAmount: wart,
      nonceId: nonce,
    });
    console.log('Submitted — nonce', res.nonce, 'tx', res.txHash || '(pending hash)');
    return;
  }

  if (cmd === 'sell') {
    const market = findMarketByName(markets, opts.asset);
    if (!market) throw new Error(`Unknown or illiquid asset: ${opts.asset}`);
    const amount = opts.amount || '1';
    const held = Number(balances.assets[market.name] || 0);
    if (held < Number(amount)) {
      throw new Error(`Insufficient ${market.name} balance (${held})`);
    }
    console.log(`\nSelling ${amount} ${market.name} for WART @ ~${market.spotLabel} (-5% limit)...`);
    const res = await sellToPool({
      api,
      privateKey: wallet.privateKey,
      market,
      assetAmount: amount,
      nonceId: nonce,
    });
    console.log('Submitted — nonce', res.nonce, 'tx', res.txHash || '(pending hash)');
    return;
  }

  if (cmd === 'probe') {
    console.log('\n--- Probe: WART → MHJ (cheap asset) ---');
    const mhj = findMarketByName(markets, 'MHJ');
    if (!mhj) throw new Error('MHJ pool not found');

    const buyRes = await buyFromPool({
      api,
      privateKey: wallet.privateKey,
      market: mhj,
      wartAmount: '0.5',
      nonceId: nonce,
    });
    console.log('BUY MHJ — nonce', buyRes.nonce, 'tx', buyRes.txHash);
    nonce = buyRes.nonce + 1;

    console.log('\n--- Probe: BUN → WART (sell small slice) ---');
    const bun = findMarketByName(markets, 'BUN');
    if (!bun) throw new Error('BUN pool not found');
    const bunBal = Number(balances.assets.BUN || 0);
    if (bunBal < 0.5) {
      console.log('Skipping BUN sell — balance too low:', bunBal);
      return;
    }

    const sellRes = await sellToPool({
      api,
      privateKey: wallet.privateKey,
      market: bun,
      assetAmount: '0.5',
      nonceId: nonce,
    });
    console.log('SELL BUN — nonce', sellRes.nonce, 'tx', sellRes.txHash);
    console.log('\nProbe done. Run `wartbot balances` after a block confirms.');
    return;
  }

  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});