// TransactionHistory.jsx - DeFi-aware full implementation.
// Supports all Warthog v0.10+ node tx types from /account/:addr/history (Block.body):
// reward, wartTransfer, tokenTransfer, limitSwap, liquidityDeposit, liquidityWithdrawal,
// assetCreation, match, cancelation + legacy public node flat transfers/rewards.
import React, { useState, useEffect } from 'react';
import { useToast } from './Toast';
import { createWarthogApi, fetchBlockDetails } from '../utils/warthogClient.js';
import { isDefiNode } from '../utils/presetNodes.js';

const PAGE_SIZE = 15;

const TransactionHistory = ({ address, node, onCountsUpdate, blockCounts, refreshTrigger }) => {
  const [allHistory, setAllHistory] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState('4294967295');
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [showTooltip24h, setShowTooltip24h] = useState(false);

  const toast = useToast();
  const [showTooltipWeek, setShowTooltipWeek] = useState(false);
  const [showTooltipMonth, setShowTooltipMonth] = useState(false);
  const [timeoutId24h, setTimeoutId24h] = useState(null);
  const [timeoutIdWeek, setTimeoutIdWeek] = useState(null);
  const [timeoutIdMonth, setTimeoutIdMonth] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(false);

  const isTestnet = isDefiNode(node);

  const asDisplayString = (value, fallback = '') => {
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
  };

  const abbreviate = (value) => {
    const str = asDisplayString(value);
    if (!str || str === 'N/A') return 'N/A';
    if (str.length <= 12) return str;
    return `${str.slice(0, 6)}...${str.slice(-4)}`;
  };

  const abbreviateTxid = (value) => {
    const str = asDisplayString(value);
    if (!str || str === 'N/A') return 'N/A';
    if (str.length <= 14) return str;
    return `${str.slice(0, 6)}…${str.slice(-6)}`;
  };

  // Safe value extractors for {str, E8, ...} or primitives from API
  const getAmountStr = (v, fallback = '0') => {
    if (v == null) return fallback;
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (typeof v === 'object') {
      if (v.str != null) return String(v.str);
      if (v.E8 !== undefined) return (Number(v.E8) / 100000000).toFixed(8);
      if (v.u64 !== undefined) return String(v.u64);
    }
    return fallback;
  };

  const getFeeStr = (v, fallback = '0') => {
    if (v == null) return fallback;
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (typeof v === 'object') {
      if (v.str != null) return String(v.str);
      if (v.E8 !== undefined) return (Number(v.E8) / 100000000).toFixed(8);
    }
    return fallback;
  };

  const formatRawAmount = (raw, precision = 8) => {
    const value = BigInt(raw);
    const divisor = 10n ** BigInt(precision);
    const whole = value / divisor;
    const frac = value % divisor;
    if (precision === 0) return whole.toString();
    const fracStr = frac.toString().padStart(precision, '0').replace(/0+$/, '');
    return fracStr ? `${whole}.${fracStr}` : whole.toString();
  };

  const sumSwappedLeg = (swaps, leg) => {
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
  };

  // Normalize ANY tx shape coming from perBlock (DeFi body.* or legacy public node)
  const normalizeTransaction = (txItem, block, categoryHint = null, viewingAddress = null) => {
    const viewer = viewingAddress ? asDisplayString(viewingAddress).toLowerCase() : null;
    const addrEq = (a) => {
      const addr = asDisplayString(a);
      return !!(addr && viewer && addr.toLowerCase() === viewer);
    };
    // Legacy public node flat shape (from /history on mainnet nodes)
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
        description: !fromA ? `Block reward ${txItem.amount || '0'} WART` : `Sent ${txItem.amount || '0'} WART`,
        isIncoming: addrEq(toAddr),
        category: categoryHint || (!fromA ? 'reward' : 'wartTransfer'),
      };
    }

    // DeFi node shape (v0.10+): entry = { historyId, transaction: { hash, data, signedCommon?, processed? } }
    // or reward entry directly under body.reward
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
    } else if (cat.includes('wart')) {
      typ = 'wart_transfer';
      assetSym = 'WART';
      incoming = addrEq(toA);
      desc = incoming ? `Received ${amt} WART` : `Sent ${amt} WART to ${abbreviate(toA)}`;
    } else if (cat.includes('token')) {
      typ = 'token_transfer';
      assetSym = data.asset?.name || data.tokenSpec || 'TOKEN';
      amt = getAmountStr(data.amount);
      incoming = addrEq(toA);
      desc = `${incoming ? 'Received' : 'Sent'} ${amt} ${assetSym}`;
    } else if (cat.includes('limitswap') || cat.includes('limit_swap')) {
      typ = 'limit_swap';
      assetSym = data.baseAsset?.name || 'ASSET';
      amt = getAmountStr(data.amount);
      const lim = data.limit?.doubleAdjusted != null ? data.limit.doubleAdjusted : (data.limit || '?');
      const dir = data.buy ? 'BUY' : 'SELL';
      desc = `${dir} limit ${amt} ${assetSym} @ ${lim}`;
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
      // fallback generic
      amt = getAmountStr(data.amount || data.supply);
      desc = (cat || 'Transaction');
    }

    const feeVal = common.fee || txItem?.fee;

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
  };

  console.log(`[HISTORY] Node type: ${isTestnet ? 'DEFI TESTNET' : 'REGULAR PUBLIC NODE'}`);

  const parseHistoryBlocks = (rawData, timestampMap, fullBlockMap) => {
    const newItems = [];
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
          const hint = key.toLowerCase().includes('reward') ? 'reward' :
                       key.toLowerCase().includes('wart') ? 'wartTransfer' :
                       key.toLowerCase().includes('token') ? 'tokenTransfer' :
                       key.toLowerCase().includes('limit') ? 'limitSwap' :
                       key.toLowerCase().includes('liquiditydeposit') ? 'liquidityDeposit' :
                       key.toLowerCase().includes('liquiditywithdraw') ? 'liquidityWithdrawal' :
                       key.toLowerCase().includes('asset') ? 'assetCreation' :
                       key.toLowerCase().includes('match') ? 'match' :
                       key.toLowerCase().includes('cancel') ? 'cancelation' : key;
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
          newItems.push(n);
        });
      }
    });
    return newItems;
  };

  useEffect(() => {
    setAllHistory([]);
    setCurrentPage(1);
    setNextCursor('4294967295');
    setHasMore(true);
    setError(null);
  }, [address, node]);

  useEffect(() => {
    if (address && node) fetchInitialHistory();
  }, [address, node, refreshTrigger]);

  useEffect(() => {
    if (allHistory.length > 0 && onCountsUpdate) {
      const rewards = allHistory.filter(tx => tx.isReward);
      const now = Date.now();

      // Calculate time periods in milliseconds
      const oneDay = 24 * 60 * 60 * 1000;
      const oneWeek = 7 * oneDay;
      const oneMonth = 30 * oneDay;

      // Filter rewards by time periods
      const rewards24h = rewards.filter(tx => tx.timestamp && (now - tx.timestamp * 1000) <= oneDay);
      const rewardsWeek = rewards.filter(tx => tx.timestamp && (now - tx.timestamp * 1000) <= oneWeek);
      const rewardsMonth = rewards.filter(tx => tx.timestamp && (now - tx.timestamp * 1000) <= oneMonth);

      onCountsUpdate({
        '24h': rewards24h.length,
        week: rewardsWeek.length,
        month: rewardsMonth.length,
        rewards24h: rewards24h.map(tx => tx.txid),
        rewardsWeek: rewardsWeek.map(tx => tx.txid),
        rewardsMonth: rewardsMonth.map(tx => tx.txid),
      });
    }
  }, [allHistory, onCountsUpdate]);

  useEffect(() => {
    const checkDarkMode = () => {
      const isDark = document.documentElement.classList.contains('dark') ||
                     window.matchMedia('(prefers-color-scheme: dark)').matches;
      setIsDarkMode(isDark);
    };

    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', checkDarkMode);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener('change', checkDarkMode);
    };
  }, []);

  const fetchInitialHistory = async () => {
    setLoading(true);
    setError(null);
    console.log(`🔍 Fetching history from ${isTestnet ? 'TESTNET/DEFI' : 'PUBLIC NODE'}...`);

    try {
      const api = await createWarthogApi(node);
      const histRes = await api.getAccountHistory(address, 4294967295);
      if (!histRes.success) {
        setAllHistory([]);
        setHasMore(false);
        setNextCursor(null);
        setCurrentPage(1);
        setError(histRes.error || 'Failed to fetch transaction history');
        setLoading(false);
        return;
      }
      const rawData = histRes.data;

      if (!rawData.perBlock || !Array.isArray(rawData.perBlock)) {
        throw new Error('Unexpected response format from history endpoint');
      }

      const { timestampMap, fullBlockMap } = await fetchBlockDetails(api, rawData.perBlock);
      const newItems = parseHistoryBlocks(rawData, timestampMap, fullBlockMap);

      const seen = new Set();
      const deduped = newItems.filter((it) => {
        if (seen.has(it.txid)) return false;
        seen.add(it.txid);
        return true;
      });

      setAllHistory(deduped);
      setNextCursor(rawData.fromId > 0 ? rawData.fromId : null);
      setHasMore(deduped.length > 0 && rawData.fromId > 0);
      setCurrentPage(1);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to fetch history');
    } finally {
      setLoading(false);
    }
  };

  const fetchMoreHistory = async () => {
    if (!hasMore || loading) return;
    setLoading(true);
    try {
      const api = await createWarthogApi(node);
      const histRes = await api.getAccountHistory(address, nextCursor);
      if (!histRes.success) {
        setHasMore(false);
        setLoading(false);
        return;
      }
      const rawData = histRes.data;

      if (!rawData.perBlock || !Array.isArray(rawData.perBlock)) {
        setHasMore(false);
        setLoading(false);
        return;
      }

      const { timestampMap, fullBlockMap } = await fetchBlockDetails(api, rawData.perBlock);
      const newItems = parseHistoryBlocks(rawData, timestampMap, fullBlockMap);

      const seen = new Set(allHistory.map((x) => x.txid));
      const fresh = newItems.filter((it) => !seen.has(it.txid));

      setAllHistory(prev => [...prev, ...fresh]);
      setHasMore(fresh.length > 0 && rawData.fromId > 0);
      setNextCursor(rawData.fromId > 0 ? rawData.fromId : null);
    } catch (err) {
      setError(err.message || 'Failed to load more history');
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    const nextPage = currentPage + 1;
    const requiredLength = nextPage * PAGE_SIZE;
    if (allHistory.length < requiredLength && hasMore) fetchMoreHistory();
    if (allHistory.length >= requiredLength || (allHistory.length < requiredLength && !hasMore)) {
      setCurrentPage(nextPage);
    }
  };

  const handlePrev = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const copyToClipboard = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Copied to clipboard');
    }).catch(() => {
      toast.error('Failed to copy to clipboard');
    });
  };

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const currentHistory = allHistory.slice(startIndex, endIndex);
  const hasNext = (endIndex < allHistory.length) || hasMore;

  const sectionColor = isDarkMode ? '#FFECB3' : '#333';
  const txBackground = isDarkMode ? '#ffecb33d' : '#ddd';
  const txBorder = isDarkMode ? '#caa21eff' : '#888';
  const txColor = isDarkMode ? '#e9e6dbff' : '#333';
  const labelColor = isDarkMode ? '#caa21eff' : '#333';

  return (
    <>
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
      <section style={{ fontFamily: 'Montserrat', color: sectionColor }}>
        <div className="flex flex-col md:flex-row justify-between md:items-center">
          {blockCounts && (
            <div className="flex items-center gap-2 flex-wrap order-1 md:order-2 mt-2 md:mt-0 mb-1">
              {[
                {
                  key: '24h',
                  label: '24h',
                  count: blockCounts['24h'],
                  txids: blockCounts.rewards24h,
                  show: showTooltip24h,
                  setShow: setShowTooltip24h,
                  timeoutId: timeoutId24h,
                  setTimeoutId: setTimeoutId24h,
                  tooltipTitle: 'Reward TXIDs (24h)',
                },
                {
                  key: 'week',
                  label: 'Week',
                  count: blockCounts.week,
                  txids: blockCounts.rewardsWeek,
                  show: showTooltipWeek,
                  setShow: setShowTooltipWeek,
                  timeoutId: timeoutIdWeek,
                  setTimeoutId: setTimeoutIdWeek,
                  tooltipTitle: 'Reward TXIDs (Week)',
                },
                {
                  key: 'month',
                  label: 'Month',
                  count: blockCounts.month,
                  txids: blockCounts.rewardsMonth,
                  show: showTooltipMonth,
                  setShow: setShowTooltipMonth,
                  timeoutId: timeoutIdMonth,
                  setTimeoutId: setTimeoutIdMonth,
                  tooltipTitle: 'Reward TXIDs (Month)',
                },
              ].map((period) => (
                <span
                  key={period.key}
                  className="compact-btn-tooltip-host"
                  onMouseEnter={() => {
                    if (period.timeoutId) clearTimeout(period.timeoutId);
                    period.setShow(true);
                  }}
                  onMouseLeave={() => {
                    const id = setTimeout(() => period.setShow(false), 1000);
                    period.setTimeoutId(id);
                  }}
                >
                  <span className="compact-btn hover:!text-[#FDB913] !mx-0 !my-0 !px-3 !py-1 cursor-default">
                    {period.label} · <span className="font-semibold tabular-nums">{period.count}</span>
                  </span>
                  {period.show && period.count > 0 && (
                    <div className="absolute top-full left-0 mt-1.5 min-w-[220px] max-w-md bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded-xl p-3 z-[100] shadow-2xl shadow-black/50 text-left font-normal normal-case">
                      <div className="font-semibold mb-1.5 text-[#FDB913]">{period.tooltipTitle}</div>
                      {period.txids.length > 0 ? (
                        <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                          {period.txids.map((txid, i) => {
                            const id = asDisplayString(txid, `reward-${period.key}-${i}`);
                            return (
                              <li
                                key={id}
                                className="break-all cursor-pointer hover:text-[#FDB913] hover:underline font-mono"
                                onClick={() => copyToClipboard(id)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    copyToClipboard(id);
                                  }
                                }}
                                role="button"
                                tabIndex={0}
                              >
                                {abbreviate(id)}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="text-zinc-500 italic">Reward hashes not available for this period.</p>
                      )}
                      <p className="text-[10px] text-zinc-500 mt-2">Click a hash to copy</p>
                    </div>
                  )}
                </span>
              ))}
            </div>
          )}
          <h2 className="text-base font-semibold text-orange-400 flex items-center gap-2 flex-wrap order-2 md:order-1">
            Transaction History <span className="text-sm">(Page {currentPage})</span>
            <span
              className={`inline-block w-2 h-2 rounded-full ${loading ? 'bg-yellow-400 animate-pulse' : 'bg-green-500'}`}
            ></span>
          </h2>
        </div>

        {error && <div className="error"><strong>Error:</strong> {error}</div>}
        {allHistory.length === 0 && !loading && <p>No transactions found.</p>}

        {currentHistory.length > 0 && (
          <div style={{ maxHeight: '420px', overflowY: 'auto', paddingRight: '10px' }}>
            {currentHistory.map((tx, index) => {
              // Type badge styling
              const typeLabel = (tx.type || tx.category || 'tx').toUpperCase().replace(/_/g, ' ');
              let badgeBg = '#444';
              let badgeColor = '#fff';
              if (tx.isReward || tx.type === 'reward') { badgeBg = '#166534'; badgeColor = '#86efac'; }
              else if (tx.type === 'wart_transfer') { badgeBg = '#1e3a8a'; badgeColor = '#93c5fd'; }
              else if (tx.type === 'token_transfer') { badgeBg = '#312e81'; badgeColor = '#a5b4fc'; }
              else if (tx.type === 'limit_swap') { badgeBg = '#581c87'; badgeColor = '#d8b4fe'; }
              else if (tx.type && tx.type.includes('liquidity')) { badgeBg = '#134e4b'; badgeColor = '#5eead4'; }
              else if (tx.type === 'asset_creation') { badgeBg = '#854d0e'; badgeColor = '#fde047'; }
              else if (tx.type === 'match') { badgeBg = '#701a75'; badgeColor = '#f0abfc'; }
              else if (tx.type === 'cancelation') { badgeBg = '#7f1d1d'; badgeColor = '#fca5a5'; }

              return (
                <div
                  key={index}
                  style={{
                    backgroundColor: txBackground,
                    border: `1px solid ${txBorder}`,
                    borderRadius: '8px',
                    padding: '14px 16px',
                    marginBottom: '14px',
                    color: txColor
                  }}
                >
                  {/* Header row: type badge + txid */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        letterSpacing: '0.5px',
                        padding: '2px 9px',
                        borderRadius: '999px',
                        background: badgeBg,
                        color: badgeColor,
                        textTransform: 'uppercase'
                      }}
                    >
                      {typeLabel}
                    </span>
                    <span
                      title={asDisplayString(tx.txid, 'N/A')}
                      style={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px' }}
                      onClick={() => copyToClipboard(asDisplayString(tx.txid))}
                    >
                      {abbreviateTxid(tx.txid)}
                    </span>
                  </div>

                  {/* One-line description of the action */}
                  {tx.description && (
                    <div style={{ marginBottom: '8px', fontSize: '13px', opacity: 0.95 }}>
                      {tx.description}
                    </div>
                  )}

                  {/* From / origin (for signed user txs and rewards) */}
                  {(tx.fromAddress || tx.isReward) && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
                      <strong style={{ color: labelColor, minWidth: 42 }}>From:</strong>
                      <span
                        title={tx.isReward || !tx.fromAddress ? 'Block Reward / System' : asDisplayString(tx.fromAddress)}
                        style={{ cursor: tx.fromAddress ? 'pointer' : 'default', fontFamily: 'monospace' }}
                        onClick={() => tx.fromAddress && copyToClipboard(asDisplayString(tx.fromAddress))}
                      >
                        {tx.isReward || !tx.fromAddress ? 'System / Reward' : abbreviate(tx.fromAddress)}
                      </span>
                    </div>
                  )}

                  {/* To (when applicable) */}
                  {tx.toAddress && tx.type !== 'limit_swap' && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
                      <strong style={{ color: labelColor, minWidth: 42 }}>To:</strong>
                      <span
                        title={asDisplayString(tx.toAddress)}
                        style={{ cursor: 'pointer', fontFamily: 'monospace' }}
                        onClick={() => copyToClipboard(asDisplayString(tx.toAddress))}
                      >
                        {abbreviate(tx.toAddress)}
                      </span>
                    </div>
                  )}

                  {/* Amount + Asset (core for all) */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
                    <strong style={{ color: labelColor, minWidth: 42 }}>Amount:</strong>
                    <span style={{ fontFamily: 'monospace' }}>
                      {tx.amount} <span style={{ opacity: 0.7 }}>{tx.asset}</span>
                    </span>
                  </div>

                  {/* Fee (only for user signed actions) */}
                  {tx.fee && tx.fee !== '0' && tx.type !== 'reward' && tx.type !== 'match' && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
                      <strong style={{ color: labelColor, minWidth: 42 }}>Fee:</strong>
                      <span style={{ fontFamily: 'monospace' }}>{tx.fee} WART</span>
                    </div>
                  )}

                  {/* Confirmations / Height / Date row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', opacity: 0.85, marginTop: '6px', borderTop: `1px solid ${txBorder}`, paddingTop: '6px' }}>
                    <span>Conf: {tx.confirmations ?? '—'}</span>
                    <span>H: {tx.height ?? '—'}</span>
                    <span style={{ fontFamily: 'monospace' }}>
                      {tx.timestamp
                        ? new Date(Number(tx.timestamp) * 1000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
                        : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            className="compact-btn"
            onClick={handlePrev}
            disabled={currentPage === 1 || loading}
          >
            Previous
          </button>
          <button
            type="button"
            className="compact-btn"
            onClick={handleNext}
            disabled={!hasNext || loading}
          >
            Next
          </button>
        </div>
      </section>
    </>
  );
};

export default TransactionHistory;
