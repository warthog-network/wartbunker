// TransactionHistory.jsx - COMPLETE FILE (timestamps now work on BOTH public nodes + DeFi testnet)
import React, { useState, useEffect } from 'react';
import axios from 'axios';

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
  const [showTooltipWeek, setShowTooltipWeek] = useState(false);
  const [showTooltipMonth, setShowTooltipMonth] = useState(false);
  const [timeoutId24h, setTimeoutId24h] = useState(null);
  const [timeoutIdWeek, setTimeoutIdWeek] = useState(null);
  const [timeoutIdMonth, setTimeoutIdMonth] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(false);

  const isTestnet = node?.includes('localhost') || node?.includes('test') || node?.includes('defi') || node?.includes('127.0.0.1');

  const abbreviate = (str) => str ? `${str.slice(0,6)}...${str.slice(-4)}` : 'N/A';

  const normalizeTransaction = (txItem, block) => {
    // Public node structure (flat)
    if (txItem.txHash) {
      return {
        txid: txItem.txHash,
        fromAddress: txItem.fromAddress || null,
        toAddress: txItem.toAddress || 'N/A',
        amount: txItem.amount || txItem.amountE8?.toString() || '0',
        fee: txItem.fee?.str || txItem.fee?.E8?.toString() || '0',
        confirmations: block?.confirmations,
        height: block?.height,
        timestamp: null,
        isReward: !txItem.fromAddress,
      };
    }

    // DeFi testnet structure (nested)
    const tx = txItem.transaction || {};
    const data = tx.data || {};
    const signing = tx.signingData || {};

    return {
      txid: tx.hash || 'N/A',
      fromAddress: signing.originAddress || null,
      toAddress: data.toAddress || 'N/A',
      amount: data.amount?.str || data.amount?.E8?.toString() || '0',
      fee: signing.fee?.str || signing.fee?.E8?.toString() || '0',
      confirmations: block?.confirmations,
      height: block?.height,
      timestamp: null,
      isReward: !signing.originAddress,
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
    console.log(`🔍 Fetching history from ${isTestnet ? 'TESTNET' : 'PUBLIC NODE'}...`);

    try {
      const nodeBaseParam = `nodeBase=${encodeURIComponent(node)}`;
      const response = await axios.get(`${API_URL}?nodePath=account/${address}/history/4294967295&${nodeBaseParam}`);
      const rawData = response.data.data || response.data;

      console.log('🔍 RAW RESPONSE:', JSON.stringify(rawData, null, 2));

      if (!rawData.perBlock || !Array.isArray(rawData.perBlock)) {
        throw new Error('Unexpected response format');
      }

      // ALWAYS fetch timestamps from /chain/block/{height} for BOTH node types
      const blockPromises = rawData.perBlock.map(block =>
        axios.get(`${API_URL}?nodePath=chain/block/${block.height}&${nodeBaseParam}`)
      );
      const blockResponses = await Promise.allSettled(blockPromises);

      const timestampMap = {};
      blockResponses.forEach((res, idx) => {
        if (res.status === 'fulfilled') {
          const blockData = res.value.data.data || res.value.data;
          timestampMap[rawData.perBlock[idx].height] = blockData.timestamp;
        }
      });

      const newItems = rawData.perBlock.flatMap(block => {
        const txs = [
          ...(block.transactions?.rewards || []),
          ...(block.transactions?.transfers || []),
          ...(block.transactions?.wartTransfers || []),
        ];
        return txs.map(txItem => {
          const normalized = normalizeTransaction(txItem, block);
          normalized.timestamp = timestampMap[block.height];
          return normalized;
        });
      });

      setAllHistory(newItems);
      setNextCursor(rawData.fromId > 0 ? rawData.fromId : null);
      setHasMore(newItems.length > 0 && rawData.fromId > 0);
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

      const blockPromises = rawData.perBlock.map(block =>
        axios.get(`${API_URL}?nodePath=chain/block/${block.height}&${nodeBaseParam}`)
      );
      const blockResponses = await Promise.allSettled(blockPromises);

      const timestampMap = {};
      blockResponses.forEach((res, idx) => {
        if (res.status === 'fulfilled') {
          const blockData = res.value.data.data || res.value.data;
          timestampMap[rawData.perBlock[idx].height] = blockData.timestamp;
        }
      });

      const newItems = rawData.perBlock.flatMap(block => {
        const txs = [
          ...(block.transactions?.rewards || []),
          ...(block.transactions?.transfers || []),
          ...(block.transactions?.wartTransfers || []),
        ];
        return txs.map(txItem => {
          const normalized = normalizeTransaction(txItem, block);
          normalized.timestamp = timestampMap[block.height];
          return normalized;
        });
      });

      setAllHistory(prev => [...prev, ...newItems]);
      setHasMore(newItems.length > 0 && rawData.fromId > 0);
      setNextCursor(rawData.fromId > 0 ? rawData.fromId : null);
    } catch (err) {
      setError(err.message);
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
    navigator.clipboard.writeText(text).then(() => {
      alert('Copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy: ', err);
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
          <div style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '10px' }}>
            {currentHistory.map((tx, index) => (
              <div
                key={index}
                style={{
                  backgroundColor: txBackground,
                  border: `1px solid ${txBorder}`,
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '16px',
                  color: txColor
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <strong style={{ color: labelColor }}>TxID:</strong>
                  <span title={tx.txid || 'N/A'} style={{ cursor: 'pointer' }} onClick={() => copyToClipboard(tx.txid || '')}>
                    {tx.txid ? `${tx.txid.slice(0, 6)}...${tx.txid.slice(-6)}` : 'N/A'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <strong style={{ color: labelColor }}>From:</strong>
                  <span
                    title={!tx.fromAddress ? 'Block Reward' : tx.fromAddress}
                    style={{ cursor: tx.fromAddress ? 'pointer' : 'default' }}
                    onClick={() => tx.fromAddress && copyToClipboard(tx.fromAddress)}
                  >
                    {!tx.fromAddress ? 'Block Reward' : `${tx.fromAddress.slice(0, 6)}...${tx.fromAddress.slice(-6)}`}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <strong style={{ color: labelColor }}>To:</strong>
                  <span title={tx.toAddress || 'N/A'} style={{ cursor: 'pointer' }} onClick={() => copyToClipboard(tx.toAddress || '')}>
                    {tx.toAddress ? `${tx.toAddress.slice(0, 6)}...${tx.toAddress.slice(-6)}` : 'N/A'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <strong style={{ color: labelColor }}>Amount (WART):</strong>
                  <span>{tx.amount}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <strong style={{ color: labelColor }}>Fee (WART):</strong>
                  <span>{tx.fee}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <strong style={{ color: labelColor }}>Confirmations:</strong>
                  <span>{tx.confirmations ?? 'N/A'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <strong style={{ color: labelColor }}>Height:</strong>
                  <span>{tx.height ?? 'N/A'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ color: labelColor }}>Date:</strong>
                  <span>
                    {tx.timestamp
                      ? new Date(tx.timestamp * 1000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
                      : 'N/A (no timestamp)'}
                  </span>
                </div>
              </div>
            ))}
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
