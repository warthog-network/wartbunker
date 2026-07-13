/**
 * Parse node /account/:addr/history pages (DeFi testnet + legacy mainnet shapes).
 * Used when the explorer indexer is unavailable. Prefer warthogIndexer.js for
 * history when an indexer base is configured.
 */

export function asDisplayString(value, fallback = '') {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'object') {
    if (typeof value.hex === 'string') return value.hex;
    if (typeof value.str === 'string') return value.str;
    if (typeof value.txHash === 'string') return value.txHash;
    if (typeof value.hash === 'string') return value.hash;
    if (typeof value.address === 'string') return value.address;
    if (typeof value.toHex === 'function') {
      try {
        return value.toHex();
      } catch {
        /* fall through */
      }
    }
  }
  return fallback;
}

export function abbreviate(value) {
  const str = asDisplayString(value);
  if (!str || str === 'N/A') return 'N/A';
  if (str.length <= 12) return str;
  return `${str.slice(0, 6)}...${str.slice(-4)}`;
}

export function getAmountStr(v, fallback = '0') {
  if (v == null) return fallback;
  if (typeof v === 'string') {
    const t = v.trim();
    return t || fallback;
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return fallback;
    return String(v);
  }
  if (typeof v === 'object') {
    if (v.str != null && String(v.str).trim() !== '') return String(v.str);
    if (v.E8 !== undefined) return (Number(v.E8) / 100000000).toFixed(8);
    if (v.u64 !== undefined) {
      const decimals = Number.isFinite(Number(v.decimals))
        ? Math.min(18, Math.max(0, Number(v.decimals)))
        : 8;
      try {
        const value = BigInt(v.u64);
        const divisor = 10n ** BigInt(decimals);
        const whole = value / divisor;
        const frac = value % divisor;
        if (decimals === 0) return whole.toString();
        const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
        return fracStr ? `${whole}.${fracStr}` : whole.toString();
      } catch {
        return fallback;
      }
    }
  }
  return fallback;
}

export function getFeeStr(v, fallback = '0') {
  if (v == null) return fallback;
  if (typeof v === 'object') {
    if (v.str != null && String(v.str).trim() !== '') return String(v.str);
    if (v.E8 !== undefined) return (Number(v.E8) / 100000000).toFixed(8);
  }
  if (typeof v === 'string') {
    const t = v.trim();
    return t || fallback;
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return fallback;
    if (Number.isInteger(v) && Math.abs(v) >= 1000) {
      return (v / 100000000).toFixed(8);
    }
    return String(v);
  }
  return fallback;
}

function formatRawAmount(raw, precision = 8) {
  const value = BigInt(raw);
  const divisor = 10n ** BigInt(precision);
  const whole = value / divisor;
  const frac = value % divisor;
  if (precision === 0) return whole.toString();
  const fracStr = frac.toString().padStart(precision, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

function sumSwappedLeg(swaps, leg) {
  if (!swaps?.length) return null;
  if (swaps.length === 1) {
    const v = swaps[0]?.swapped?.[leg];
    return v ? getAmountStr(v) : null;
  }

  let total = 0n;
  let precision = 8;
  for (const swap of swaps) {
    const v = swap?.swapped?.[leg];
    if (!v) continue;
    if (v.u64 !== undefined) {
      total += BigInt(v.u64);
      if (v.decimals !== undefined) precision = v.decimals;
    } else if (v.E8 !== undefined) {
      total += BigInt(v.E8);
      precision = 8;
    }
  }
  return total > 0n ? formatRawAmount(total, precision) : null;
}

/** Normalize ANY tx shape coming from perBlock (DeFi body.* or legacy public node). */
export function normalizeTransaction(txItem, block, categoryHint = null, viewingAddress = null) {
  const viewer = viewingAddress ? asDisplayString(viewingAddress).toLowerCase() : null;
  const addrEq = (a) => {
    const addr = asDisplayString(a);
    return !!(addr && viewer && addr.toLowerCase() === viewer);
  };

  // Legacy public node flat shape
  if (txItem && txItem.txHash) {
    const fromA = asDisplayString(txItem.fromAddress, null) || null;
    const toAddr = asDisplayString(txItem.toAddress, 'N/A') || 'N/A';
    return {
      txid: asDisplayString(txItem.txHash, 'N/A'),
      fromAddress: fromA,
      toAddress: toAddr,
      amount: txItem.amount || getAmountStr(txItem.amountE8),
      fee: getFeeStr(txItem.fee),
      confirmations: block?.confirmations,
      height: block?.height,
      timestamp: null,
      isReward: !fromA,
      type: !fromA ? 'reward' : 'wart_transfer',
      asset: 'WART',
      description: !fromA
        ? `Block reward ${txItem.amount || '0'} WART`
        : `Sent ${txItem.amount || '0'} WART`,
      isIncoming: addrEq(toAddr),
      category: categoryHint || (!fromA ? 'reward' : 'wartTransfer'),
    };
  }

  // DeFi node shape (v0.10+)
  const tx = (txItem && txItem.transaction) ? txItem.transaction : (txItem || {});
  const data = tx.data || txItem?.data || {};
  const common = tx.signedCommon || tx.signingData || txItem?.signedCommon || {};

  const hash = asDisplayString(tx.hash || txItem?.hash, 'N/A');
  const fromA = asDisplayString(common.originAddress || data.fromAddress, null) || null;
  const toA = asDisplayString(data.toAddress, null) || null;

  let typ = categoryHint || 'unknown';
  let amt = getAmountStr(data.amount);
  let assetSym = 'WART';
  let desc = '';
  let incoming = false;

  const cat = (categoryHint || '').toLowerCase();

  if (cat.includes('reward') || (!fromA && !data.toAddress && data.amount)) {
    typ = 'reward';
    amt = getAmountStr(data.amount);
    assetSym = 'WART';
    incoming = addrEq(toA);
    desc = `Block reward ${amt} WART`;
  } else if (cat.includes('token')) {
    typ = 'token_transfer';
    assetSym = data.asset?.name || data.tokenSpec || 'TOKEN';
    amt = getAmountStr(data.amount);
    incoming = addrEq(toA);
    desc = `${incoming ? 'Received' : 'Sent'} ${amt} ${assetSym}`;
  } else if (
    cat.includes('wart')
    || cat === 'transfers'
    || cat === 'transfer'
    || cat.includes('warttransfer')
  ) {
    typ = 'wart_transfer';
    assetSym = 'WART';
    incoming = addrEq(toA);
    desc = incoming ? `Received ${amt} WART` : `Sent ${amt} WART to ${abbreviate(toA)}`;
  } else if (cat.includes('limitswap') || cat.includes('limit_swap')) {
    typ = 'limit_swap';
    assetSym = data.baseAsset?.name || 'ASSET';
    amt = getAmountStr(data.amount);
    const lim = data.limit?.doubleAdjusted != null ? data.limit.doubleAdjusted : (data.limit || '?');
    const isBuy = data.buy === true || data.buy === 1 || data.buy === 'true';
    const dir = isBuy ? 'BUY' : 'SELL';
    const amountUnit = isBuy ? 'WART' : assetSym;
    assetSym = amountUnit;
    desc = isBuy
      ? `${dir} limit ${amt} WART for ${data.baseAsset?.name || 'ASSET'} @ ${lim}`
      : `${dir} limit ${amt} ${data.baseAsset?.name || 'ASSET'} @ ${lim}`;
    incoming = false;
  } else if (cat.includes('liquiditydeposit') || cat.includes('liquidity_deposit')) {
    typ = 'liquidity_deposit';
    assetSym = asDisplayString(data.baseAsset?.name) || 'POOL';
    const dep = data.deposited || {};
    const processed = tx.processed || txItem?.transaction?.processed || {};
    const sharesReceived = getAmountStr(processed.sharesReceived);
    amt = `${getAmountStr(dep.asset || dep.base || dep)} + ${getAmountStr(dep.wart || dep.quote || '0')}`;
    desc = sharesReceived && sharesReceived !== '0'
      ? `Deposited ${amt} into ${assetSym} pool → received ${sharesReceived} LP shares`
      : `Deposited liquidity into ${assetSym} pool`;
  } else if (cat.includes('liquiditywithdraw') || cat.includes('liquidity_withdrawal')) {
    typ = 'liquidity_withdrawal';
    assetSym = asDisplayString(data.baseAsset?.name) || 'POOL';
    const shares = getAmountStr(data.sharesRedeemed);
    const processed = tx.processed || txItem?.transaction?.processed || {};
    const received = processed.received || {};
    const baseRecv = getAmountStr(received.base || received.asset);
    const quoteRecv = getAmountStr(received.quote || received.wart);
    incoming = true;
    if (baseRecv !== '0' || quoteRecv !== '0') {
      amt = `${baseRecv} ${assetSym} + ${quoteRecv} WART`;
      desc = `Withdrew ${shares} LP shares from ${assetSym} pool → received ${baseRecv} ${assetSym} + ${quoteRecv} WART`;
    } else {
      amt = shares;
      desc = `Withdrew ${shares} LP shares from ${assetSym} pool`;
    }
  } else if (cat.includes('assetcreation') || cat.includes('asset_creation')) {
    typ = 'asset_creation';
    assetSym = data.name || 'ASSET';
    amt = getAmountStr(data.supply);
    desc = `Created ${assetSym} (supply ${amt})`;
  } else if (cat.includes('match')) {
    typ = 'match';
    assetSym = data.baseAsset?.name || 'ASSET';
    const buySwaps = data.buySwaps || [];
    const sellSwaps = data.sellSwaps || [];
    const allSwaps = [...buySwaps, ...sellSwaps];
    const swapCount = allSwaps.length;
    const baseAmt = sumSwappedLeg(allSwaps, 'base');
    const quoteAmt = sumSwappedLeg(allSwaps, 'quote');
    amt = baseAmt || '0';
    desc = `DEX match${swapCount ? ` (${swapCount} swap${swapCount !== 1 ? 's' : ''})` : ''} on ${assetSym}`;
    if (baseAmt && quoteAmt) {
      desc += ` — ${baseAmt} ${assetSym} / ${quoteAmt} WART`;
    }
  } else if (cat.includes('cancel')) {
    typ = 'cancelation';
    desc = `Canceled tx ${abbreviate(data.cancelTxid)}`;
  } else {
    amt = getAmountStr(data.amount || data.supply);
    desc = (cat || 'Transaction');
  }

  const feeVal = common.fee || txItem?.fee || common.feeE8 || txItem?.feeE8;

  return {
    txid: hash,
    fromAddress: fromA,
    toAddress: toA,
    amount: amt,
    fee: getFeeStr(feeVal),
    confirmations: block?.confirmations,
    height: block?.height,
    timestamp: null,
    isReward: typ === 'reward',
    type: typ,
    asset: assetSym,
    description: desc,
    isIncoming: incoming,
    category: cat || typ,
  };
}

/**
 * Flatten a history API page (rawData.perBlock) into normalized tx items.
 * @param {object} rawData
 * @param {Record<number, unknown>} timestampMap
 * @param {Record<number, unknown>} fullBlockMap
 * @param {string} address viewing account
 */
export function parseHistoryBlocks(rawData, timestampMap, fullBlockMap, address) {
  const newItems = [];
  if (!rawData?.perBlock || !Array.isArray(rawData.perBlock)) return newItems;

  rawData.perBlock.forEach((block) => {
    const h = block.height;
    const srcBlock = fullBlockMap[h] || block;
    const body = block.body || srcBlock?.body || block.transactions || srcBlock?.transactions || {};

    const rewardEntry = body.reward;
    if (rewardEntry) {
      const list = Array.isArray(rewardEntry) ? rewardEntry : [rewardEntry];
      list.forEach((entry) => {
        if (entry) {
          const n = normalizeTransaction(entry, srcBlock || block, 'reward', address);
          n.timestamp = block.header?.time?.timestamp || timestampMap[h] || n.timestamp;
          newItems.push(n);
        }
      });
    }

    const defiKeys = [
      'wartTransfer', 'tokenTransfer', 'limitSwap', 'liquidityDeposit', 'liquidityWithdrawal',
      'assetCreation', 'match', 'cancelation',
      'wartTransfers', 'tokenTransfers', 'transfers', 'rewards',
    ];
    defiKeys.forEach((key) => {
      const arr = body[key];
      if (Array.isArray(arr)) {
        const k = key.toLowerCase();
        const hint = k.includes('reward') ? 'reward'
          : (k === 'transfers' || k === 'transfer' || k.includes('wart')) ? 'wartTransfer'
            : k.includes('token') ? 'tokenTransfer'
              : k.includes('limit') ? 'limitSwap'
                : k.includes('liquiditydeposit') ? 'liquidityDeposit'
                  : k.includes('liquiditywithdraw') ? 'liquidityWithdrawal'
                    : k.includes('asset') ? 'assetCreation'
                      : k.includes('match') ? 'match'
                        : k.includes('cancel') ? 'cancelation' : key;
        arr.forEach((entry) => {
          if (entry) {
            const n = normalizeTransaction(entry, srcBlock || block, hint, address);
            n.timestamp = block.header?.time?.timestamp || timestampMap[h] || n.timestamp;
            newItems.push(n);
          }
        });
      }
    });

    if (body.transfers && Array.isArray(body.transfers)) {
      body.transfers.forEach((t) => {
        const n = normalizeTransaction(t, srcBlock || block, 'wartTransfer', address);
        n.timestamp = block.header?.time?.timestamp || timestampMap[h] || n.timestamp;
        if (!newItems.find((x) => x.txid === n.txid)) newItems.push(n);
      });
    }
    if (body.rewards && Array.isArray(body.rewards)) {
      body.rewards.forEach((r) => {
        const n = normalizeTransaction(r, srcBlock || block, 'reward', address);
        n.timestamp = block.header?.time?.timestamp || timestampMap[h] || n.timestamp;
        if (!newItems.find((x) => x.txid === n.txid)) newItems.push(n);
      });
    }
  });

  return newItems;
}
