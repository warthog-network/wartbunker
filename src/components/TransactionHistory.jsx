// TransactionHistory.jsx - DeFi-aware full implementation.
// Supports all Warthog v0.10+ node tx types from /account/:addr/history (Block.body):
// reward, wartTransfer, tokenTransfer, limitSwap, liquidityDeposit, liquidityWithdrawal,
// assetCreation, match, cancelation + legacy public node flat transfers/rewards.
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useToast } from './Toast';

const API_URL = '/api/proxy';
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

  const isTestnet = node?.includes('localhost') || node?.includes('test') || node?.includes('defi') || node?.includes('127.0.0.1');

  const abbreviate = (str) => str ? `${str.slice(0,6)}...${str.slice(-4)}` : 'N/A';

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

  // Normalize ANY tx shape coming from perBlock (DeFi body.* or legacy public node)
  const normalizeTransaction = (txItem, block, categoryHint = null, viewingAddress = null) => {
    // Legacy public node flat shape (from /history on mainnet nodes)
    if (txItem && txItem.txHash) {
      const fromA = txItem.fromAddress || null;
      return {
        txid: txItem.txHash,
        fromAddress: fromA,
        toAddress: txItem.toAddress || 'N/A',
        amount: txItem.amount || getAmountStr(txItem.amountE8),
        fee: getFeeStr(txItem.fee),
        confirmations: block?.confirmations,
        height: block?.height,
        timestamp: null,
        isReward: !fromA,
        type: !fromA ? 'reward' : 'wart_transfer',
        asset: 'WART',
        description: !fromA ? `Block reward ${txItem.amount || '0'} WART` : `Sent ${txItem.amount || '0'} WART`,
        isIncoming: !!(txItem.toAddress && txItem.toAddress === viewingAddress),
        category: categoryHint || (!fromA ? 'reward' : 'wartTransfer'),
      };
    }

    // DeFi node shape (v0.10+): entry = { historyId, transaction: { hash, data, signedCommon?, processed? } }
    // or reward entry directly under body.reward
    const tx = (txItem && txItem.transaction) ? txItem.transaction : (txItem || {});
    const data = tx.data || txItem?.data || {};
    const common = tx.signedCommon || tx.signingData || txItem?.signedCommon || {};

    const hash = tx.hash || txItem?.hash || 'N/A';
    const fromA = common.originAddress || data.fromAddress || null;
    const toA = data.toAddress || null;

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
      incoming = toA === viewingAddress;
      desc = `Block reward ${amt} WART`;
    } else if (cat.includes('wart')) {
      typ = 'wart_transfer';
      assetSym = 'WART';
      incoming = toA === viewingAddress;
      desc = incoming ? `Received ${amt} WART` : `Sent ${amt} WART to ${abbreviate(toA)}`;
    } else if (cat.includes('token')) {
      typ = 'token_transfer';
      assetSym = data.asset?.name || data.tokenSpec || 'TOKEN';
      amt = getAmountStr(data.amount);
      incoming = toA === viewingAddress;
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
      assetSym = data.baseAsset?.name || 'POOL';
      const dep = data.deposited || {};
      amt = `${getAmountStr(dep.asset || dep.base || dep)} + ${getAmountStr(dep.wart || dep.quote || '0')}`;
      desc = `Deposited liquidity to ${assetSym} pool`;
    } else if (cat.includes('liquiditywithdraw') || cat.includes('liquidity_withdrawal')) {
      typ = 'liquidity_withdrawal';
      assetSym = data.baseAsset?.name || 'POOL';
      amt = getAmountStr(data.sharesRedeemed);
      desc = `Redeemed ${amt} shares from ${assetSym} pool`;
    } else if (cat.includes('assetcreation') || cat.includes('asset_creation')) {
      typ = 'asset_creation';
      assetSym = data.name || 'ASSET';
      amt = getAmountStr(data.supply);
      desc = `Created ${assetSym} (supply ${amt})`;
    } else if (cat.includes('match')) {
      typ = 'match';
      assetSym = data.baseAsset?.name || 'ASSET';
      const swaps = ((data.buySwaps||[]).length + (data.sellSwaps||[]).length) || '';
      desc = `DEX match${swaps ? ' ('+swaps+' swaps)' : ''} on ${assetSym}`;
    } else if (cat.includes('cancel')) {
      typ = 'cancelation';
      desc = `Canceled tx ${abbreviate(data.cancelTxid || '')}`;
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

  useEffect(() => {
    if (address && node && allHistory.length === 0) fetchInitialHistory();
  }, [address, node]);

  useEffect(() => {
    if (address && node && refreshTrigger !== undefined) fetchInitialHistory();
  }, [refreshTrigger, address, node]);

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
      const nodeBaseParam = `nodeBase=${encodeURIComponent(node)}`;
      const response = await axios.get(`${API_URL}?nodePath=account/${address}/history/4294967295&${nodeBaseParam}`);
      const rawData = response.data.data || response.data;

      if (!rawData.perBlock || !Array.isArray(rawData.perBlock)) {
        // Some responses may return {code, error} with empty history
        if (rawData.code && rawData.code !== 0) {
          setAllHistory([]);
          setHasMore(false);
          setNextCursor(null);
          setCurrentPage(1);
          setLoading(false);
          return;
        }
        throw new Error('Unexpected response format from history endpoint');
      }

      // Fetch full block (for timestamps + authoritative data) when header/time not embedded
      const blockPromises = rawData.perBlock.map(block =>
        axios.get(`${API_URL}?nodePath=chain/block/${block.height}&${nodeBaseParam}`)
      );
      const blockResponses = await Promise.allSettled(blockPromises);

      const timestampMap = {};
      const fullBlockMap = {};
      blockResponses.forEach((res, idx) => {
        if (res.status === 'fulfilled') {
          const b = res.value.data.data || res.value.data;
          const h = rawData.perBlock[idx].height;
          timestampMap[h] = b?.header?.time?.timestamp || b?.timestamp || b?.header?.time;
          fullBlockMap[h] = b;
        }
      });

      const newItems = [];
      rawData.perBlock.forEach((block) => {
        const h = block.height;
        // Prefer embedded header (DeFi node) but have fullBlock as fallback
        const srcBlock = fullBlockMap[h] || block;

        // DeFi v0.10+ shape: perBlock[i].body.{reward, wartTransfer: [], tokenTransfer: [], limitSwap, liquidityDeposit, ...}
        const body = block.body || srcBlock?.body || block.transactions || srcBlock?.transactions || {};

        // Reward (can be object or array in responses)
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

        // All other DeFi action arrays under body
        const defiKeys = [
          'wartTransfer', 'tokenTransfer', 'limitSwap', 'liquidityDeposit', 'liquidityWithdrawal',
          'assetCreation', 'match', 'cancelation',
          // legacy alt names sometimes seen
          'wartTransfers', 'tokenTransfers', 'transfers', 'rewards'
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

        // Legacy public node fallback (already handled inside normalize too via txItem.txHash)
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

      // De-dupe by txid (in case of overlap in legacy paths)
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
      setError(err.response?.data?.message || err.message || 'Failed to fetch history');
    } finally {
      setLoading(false);
    }
  };

  const fetchMoreHistory = async () => {
    if (!hasMore || loading) return;
    setLoading(true);
    try {
      const nodeBaseParam = `nodeBase=${encodeURIComponent(node)}`;
      const response = await axios.get(`${API_URL}?nodePath=account/${address}/history/${nextCursor}&${nodeBaseParam}`);
      const rawData = response.data.data || response.data;

      if (!rawData.perBlock || !Array.isArray(rawData.perBlock)) {
        setHasMore(false);
        setLoading(false);
        return;
      }

      const blockPromises = rawData.perBlock.map(block =>
        axios.get(`${API_URL}?nodePath=chain/block/${block.height}&${nodeBaseParam}`)
      );
      const blockResponses = await Promise.allSettled(blockPromises);

      const timestampMap = {};
      const fullBlockMap = {};
      blockResponses.forEach((res, idx) => {
        if (res.status === 'fulfilled') {
          const b = res.value.data.data || res.value.data;
          const h = rawData.perBlock[idx].height;
          timestampMap[h] = b?.header?.time?.timestamp || b?.timestamp;
          fullBlockMap[h] = b;
        }
      });

      const newItems = [];
      rawData.perBlock.forEach((block) => {
        const h = block.height;
        const srcBlock = fullBlockMap[h] || block;
        const body = block.body || srcBlock?.body || block.transactions || srcBlock?.transactions || {};

        if (body.reward) {
          const list = Array.isArray(body.reward) ? body.reward : [body.reward];
          list.forEach((entry) => {
            if (entry) {
              const n = normalizeTransaction(entry, srcBlock || block, 'reward', address);
              n.timestamp = block.header?.time?.timestamp || timestampMap[h] || n.timestamp;
              newItems.push(n);
            }
          });
        }

        const defiKeys = ['wartTransfer','tokenTransfer','limitSwap','liquidityDeposit','liquidityWithdrawal','assetCreation','match','cancelation','wartTransfers','tokenTransfers','transfers','rewards'];
        defiKeys.forEach((key) => {
          const arr = body[key];
          if (Array.isArray(arr)) {
            const hint = key;
            arr.forEach((entry) => {
              if (entry) {
                const n = normalizeTransaction(entry, srcBlock || block, hint, address);
                n.timestamp = block.header?.time?.timestamp || timestampMap[h] || n.timestamp;
                newItems.push(n);
              }
            });
          }
        });
      });

      // de-dupe against existing
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
            <div className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-3 py-1 rounded-full text-sm font-medium order-1 md:order-2 mt-2 md:mt-0 mb-1 w-fit">
              blocks 24h <span className="relative cursor-pointer" onMouseEnter={() => { if (timeoutId24h) clearTimeout(timeoutId24h); setShowTooltip24h(true); }} onMouseLeave={() => { const id = setTimeout(() => setShowTooltip24h(false), 1000); setTimeoutId24h(id); }}>
                {blockCounts['24h']}
                {showTooltip24h && blockCounts.rewards24h.length > 0 && (
                  <div className="absolute top-full left-0 mt-1 bg-gray-700 text-white text-xs rounded p-2 z-10 max-w-md" onMouseEnter={() => { if (timeoutId24h) clearTimeout(timeoutId24h); }} onMouseLeave={() => { const id = setTimeout(() => setShowTooltip24h(false), 1000); setTimeoutId24h(id); }}>
                    <div className="font-semibold mb-1">Reward TXIDs (24h):</div>
                    <ul className="space-y-1">
                      {blockCounts.rewards24h.map(txid => <li key={txid} className="break-all cursor-pointer hover:underline" onClick={() => copyToClipboard(txid)}>{abbreviate(txid)}</li>)}
                    </ul>
                  </div>
                )}
              </span> week <span className="relative cursor-pointer" onMouseEnter={() => { if (timeoutIdWeek) clearTimeout(timeoutIdWeek); setShowTooltipWeek(true); }} onMouseLeave={() => { const id = setTimeout(() => setShowTooltipWeek(false), 1000); setTimeoutIdWeek(id); }}>
                {blockCounts.week}
                {showTooltipWeek && blockCounts.rewardsWeek.length > 0 && (
                  <div className="absolute top-full left-0 mt-1 bg-gray-700 text-white text-xs rounded p-2 z-10 max-w-md" onMouseEnter={() => { if (timeoutIdWeek) clearTimeout(timeoutIdWeek); }} onMouseLeave={() => { const id = setTimeout(() => setShowTooltipWeek(false), 1000); setTimeoutIdWeek(id); }}>
                    <div className="font-semibold mb-1">Reward TXIDs (Week):</div>
                    <ul className="space-y-1">
                      {blockCounts.rewardsWeek.map(txid => <li key={txid} className="break-all cursor-pointer hover:underline" onClick={() => copyToClipboard(txid)}>{abbreviate(txid)}</li>)}
                    </ul>
                  </div>
                )}
              </span> month <span className="relative cursor-pointer" onMouseEnter={() => { if (timeoutIdMonth) clearTimeout(timeoutIdMonth); setShowTooltipMonth(true); }} onMouseLeave={() => { const id = setTimeout(() => setShowTooltipMonth(false), 1000); setTimeoutIdMonth(id); }}>
                {blockCounts.month}
                {showTooltipMonth && blockCounts.rewardsMonth.length > 0 && (
                  <div className="absolute top-full left-0 mt-1 bg-gray-700 text-white text-xs rounded p-2 z-10 max-w-md" onMouseEnter={() => { if (timeoutIdMonth) clearTimeout(timeoutIdMonth); }} onMouseLeave={() => { const id = setTimeout(() => setShowTooltipMonth(false), 1000); setTimeoutIdMonth(id); }}>
                    <div className="font-semibold mb-1">Reward TXIDs (Month):</div>
                    <ul className="space-y-1">
                      {blockCounts.rewardsMonth.map(txid => <li key={txid} className="break-all cursor-pointer hover:underline" onClick={() => copyToClipboard(txid)}>{abbreviate(txid)}</li>)}
                    </ul>
                  </div>
                )}
              </span>
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
                      title={tx.txid || 'N/A'}
                      style={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px' }}
                      onClick={() => copyToClipboard(tx.txid || '')}
                    >
                      {tx.txid && tx.txid !== 'N/A' ? `${tx.txid.slice(0, 6)}…${tx.txid.slice(-6)}` : 'N/A'}
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
                        title={tx.isReward || !tx.fromAddress ? 'Block Reward / System' : tx.fromAddress}
                        style={{ cursor: tx.fromAddress ? 'pointer' : 'default', fontFamily: 'monospace' }}
                        onClick={() => tx.fromAddress && copyToClipboard(tx.fromAddress)}
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
                        title={tx.toAddress}
                        style={{ cursor: 'pointer', fontFamily: 'monospace' }}
                        onClick={() => copyToClipboard(tx.toAddress)}
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

        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
          <button onClick={handlePrev} disabled={currentPage === 1 || loading}>
            Previous
          </button>
          <button onClick={handleNext} disabled={!hasNext || loading}>
            Next
          </button>
        </div>
      </section>
    </>
  );
};

export default TransactionHistory;
