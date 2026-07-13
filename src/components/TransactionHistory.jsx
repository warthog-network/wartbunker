// TransactionHistory.jsx - DeFi-aware UI on top of background history cache.
// Prefers explorer indexer (warthogIndexer) for history; falls back to node RPC.
// Supports indexer types + Warthog v0.10+ node tx shapes (accountHistoryParse).
import React, { useState, useEffect, useMemo, useSyncExternalStore, useCallback } from 'react';
import { useToast } from './Toast';
import { isDefiNode } from '../utils/presetNodes.js';
import { asDisplayString, abbreviate } from '../utils/accountHistoryParse.js';
import {
  ensureHistoryPrefetch,
  getHistorySnapshot,
  loadMoreHistory,
  refreshHistoryPrefetch,
  setHistoryUiPriority,
  subscribeHistory,
  INDEXER_FILTER_CONCURRENCY,
  INDEXER_FILTER_MAX_PAGES,
} from '../utils/accountHistoryCache.js';

const PAGE_SIZE = 15;

const HISTORY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'rewards', label: 'Rewards' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'limit_swaps', label: 'Limit Swaps' },
  { id: 'matches', label: 'Matches' },
  { id: 'cancels', label: 'Cancels' },
  { id: 'asset_creations', label: 'Asset Creation' },
  { id: 'liquidity', label: 'Liquidity' },
  { id: 'in', label: 'In' },
  { id: 'out', label: 'Out' },
];

/** Normalize type strings from normalizeTransaction (and any residual category spill). */
function txTypeKey(tx) {
  const raw = String(tx?.type || tx?.category || '').toLowerCase().replace(/-/g, '_');
  if (!raw) return '';
  if (tx?.isReward || raw === 'reward' || raw.includes('reward')) return 'reward';
  if (raw === 'wart_transfer' || raw === 'warttransfer' || raw === 'transfers' || raw === 'transfer') {
    return 'wart_transfer';
  }
  if (raw === 'token_transfer' || raw === 'tokentransfer') return 'token_transfer';
  if (raw === 'limit_swap' || raw === 'limitswap') return 'limit_swap';
  if (raw === 'match') return 'match';
  if (raw === 'cancelation' || raw === 'cancellation' || raw.includes('cancel')) return 'cancelation';
  if (raw === 'asset_creation' || raw === 'assetcreation') return 'asset_creation';
  if (raw === 'liquidity_deposit' || raw === 'liquiditydeposit') return 'liquidity_deposit';
  if (raw === 'liquidity_withdrawal' || raw === 'liquiditywithdrawal' || raw.includes('liquiditywithdraw')) {
    return 'liquidity_withdrawal';
  }
  return raw;
}

function matchesHistoryFilter(tx, filter) {
  if (!filter || filter === 'all') return true;

  const type = txTypeKey(tx);
  const isReward = type === 'reward' || Boolean(tx?.isReward);
  const dir = String(tx?.direction || '').toLowerCase();

  if (filter === 'rewards') return isReward;
  if (filter === 'transfers') return type === 'wart_transfer' || type === 'token_transfer';
  if (filter === 'limit_swaps') return type === 'limit_swap';
  if (filter === 'matches') return type === 'match';
  if (filter === 'cancels') return type === 'cancelation';
  if (filter === 'asset_creations') return type === 'asset_creation';
  if (filter === 'liquidity') {
    return type === 'liquidity_deposit' || type === 'liquidity_withdrawal';
  }

  // Prefer indexer direction when present (matches server direction= filter)
  if (filter === 'in') {
    if (dir === 'in') return true;
    if (dir === 'out' || dir === 'self') return false;
    return isReward || tx?.isIncoming === true || type === 'liquidity_withdrawal';
  }

  if (filter === 'out') {
    if (dir === 'out') return true;
    if (dir === 'in' || dir === 'self') return false;
    if (isReward) return false;
    if (tx?.isIncoming === true) return false;
    if (type === 'match') return false;
    return true;
  }

  return true;
}

function filterEmptyMessage(filter) {
  switch (filter) {
    case 'rewards':
      return 'No rewards found for this address.';
    case 'transfers':
      return 'No WART or token transfers found for this address.';
    case 'limit_swaps':
      return 'No limit swaps found for this address.';
    case 'matches':
      return 'No DEX matches found for this address.';
    case 'cancels':
      return 'No cancelations found for this address.';
    case 'asset_creations':
      return 'No asset creations found for this address.';
    case 'liquidity':
      return 'No liquidity deposits or withdrawals found for this address.';
    case 'in':
      return 'No incoming transactions found for this address.';
    case 'out':
      return 'No outgoing transactions found for this address.';
    default:
      return 'No transactions found.';
  }
}

function abbreviateTxid(value) {
  const str = asDisplayString(value);
  if (!str || str === 'N/A') return 'N/A';
  if (str.length <= 14) return str;
  return `${str.slice(0, 6)}…${str.slice(-6)}`;
}

const EMPTY_SNAP = {
  items: [],
  hasMore: true,
  loading: true,
  scanning: false,
  error: null,
  pages: 0,
  source: null,
  typeFiltersSupported: null,
  filterLane: 'all',
};

function useAccountHistory(address, node, filter = 'all') {
  const subscribe = useCallback(
    (onStoreChange) => {
      if (!address || !node) return () => {};
      return subscribeHistory((key) => {
        // Re-render on any update for this account, or global clear
        if (key === '*') {
          onStoreChange();
          return;
        }
        onStoreChange();
      });
    },
    [address, node],
  );

  const getSnapshot = useCallback(() => {
    if (!address || !node) return EMPTY_SNAP;
    return getHistorySnapshot(address, node, filter) || EMPTY_SNAP;
  }, [address, node, filter]);

  // Server snapshot same as empty for SSR
  const getServerSnapshot = useCallback(() => EMPTY_SNAP, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

const TransactionHistory = ({ address, node, onCountsUpdate, blockCounts, refreshTrigger }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [historyFilter, setHistoryFilter] = useState('all');
  const [showTooltip24h, setShowTooltip24h] = useState(false);
  const toast = useToast();
  const [showTooltipWeek, setShowTooltipWeek] = useState(false);
  const [showTooltipMonth, setShowTooltipMonth] = useState(false);
  const [timeoutId24h, setTimeoutId24h] = useState(null);
  const [timeoutIdWeek, setTimeoutIdWeek] = useState(null);
  const [timeoutIdMonth, setTimeoutIdMonth] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(false);

  const isTestnet = isDefiNode(node);

  // Probe 'all' first (learns typeFiltersSupported), then dedicated filter lanes when supported.
  const allSnap = useAccountHistory(address, node, 'all');
  const typeFiltersSupported = Boolean(allSnap.typeFiltersSupported);
  const activeLane = typeFiltersSupported ? historyFilter : 'all';
  const snap = useAccountHistory(address, node, activeLane);
  // Rewards chip counts: server group=reward lane when available (not buried under other types)
  const rewardsSnap = useAccountHistory(address, node, typeFiltersSupported ? 'rewards' : 'all');

  const allHistory = snap.items || [];
  const hasMore = Boolean(snap.hasMore);
  const loading = Boolean(snap.loading);
  const scanning = Boolean(snap.scanning);
  const error = snap.error || null;
  const pagesScanned = snap.pages || 0;
  const historySource = snap.source || null;

  // Warm active filter lane (or all); prioritize while panel is open
  useEffect(() => {
    if (!address || !node) return undefined;
    ensureHistoryPrefetch(address, node, 'all');
    if (typeFiltersSupported) {
      ensureHistoryPrefetch(address, node, 'rewards');
      if (historyFilter !== 'all' && historyFilter !== 'rewards') {
        ensureHistoryPrefetch(address, node, historyFilter);
      }
    }
    setHistoryUiPriority(address, node, true, activeLane);
    return () => setHistoryUiPriority(address, node, false, activeLane);
  }, [address, node, historyFilter, typeFiltersSupported, activeLane]);

  // Manual refresh from parent — all lanes for this account
  useEffect(() => {
    if (!address || !node) return;
    if (refreshTrigger == null || refreshTrigger === 0) return;
    refreshHistoryPrefetch(address, node);
  }, [refreshTrigger, address, node]);

  useEffect(() => {
    setCurrentPage(1);
    setHistoryFilter('all');
  }, [address, node]);

  // Keep a few reward pages warm for 24h/week/month chips
  useEffect(() => {
    if (!address || !node || !typeFiltersSupported) return;
    if (!rewardsSnap.hasMore || rewardsSnap.loading || rewardsSnap.scanning) return;
    if ((rewardsSnap.items || []).length >= 150) return;
    void loadMoreHistory(address, node, { filter: 'rewards', minLoaded: 150 });
  }, [
    address,
    node,
    typeFiltersSupported,
    rewardsSnap.hasMore,
    rewardsSnap.loading,
    rewardsSnap.scanning,
    rewardsSnap.items,
  ]);

  useEffect(() => {
    const pool = rewardsSnap.items || [];
    if (pool.length === 0 || !onCountsUpdate) return;

    const rewards = typeFiltersSupported
      ? pool
      : pool.filter((tx) => tx.isReward || txTypeKey(tx) === 'reward');
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const oneWeek = 7 * oneDay;
    const oneMonth = 30 * oneDay;

    const rewards24h = rewards.filter((tx) => tx.timestamp && (now - tx.timestamp * 1000) <= oneDay);
    const rewardsWeek = rewards.filter((tx) => tx.timestamp && (now - tx.timestamp * 1000) <= oneWeek);
    const rewardsMonth = rewards.filter((tx) => tx.timestamp && (now - tx.timestamp * 1000) <= oneMonth);

    onCountsUpdate({
      '24h': rewards24h.length,
      week: rewardsWeek.length,
      month: rewardsMonth.length,
      rewards24h: rewards24h.map((tx) => tx.txid),
      rewardsWeek: rewardsWeek.map((tx) => tx.txid),
      rewardsMonth: rewardsMonth.map((tx) => tx.txid),
    });
  }, [rewardsSnap.items, typeFiltersSupported, onCountsUpdate]);

  useEffect(() => {
    const checkDarkMode = () => {
      const isDark = document.documentElement.classList.contains('dark')
        || window.matchMedia('(prefers-color-scheme: dark)').matches;
      setIsDarkMode(isDark);
    };

    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', checkDarkMode);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener('change', checkDarkMode);
    };
  }, []);

  // Server lanes already match the tab — trust them (avoids false empties from client mismatches).
  // Legacy path: client filter over the unfiltered 'all' feed.
  const filteredHistory = useMemo(() => {
    if (historyFilter === 'all' || typeFiltersSupported) return allHistory;
    return allHistory.filter((tx) => matchesHistoryFilter(tx, historyFilter));
  }, [allHistory, historyFilter, typeFiltersSupported]);

  const filterLabel =
    HISTORY_FILTERS.find((f) => f.id === historyFilter)?.label || historyFilter;

  const matchesNeededForPage = currentPage * PAGE_SIZE;
  const matchFn = useCallback(
    (tx) => matchesHistoryFilter(tx, historyFilter),
    [historyFilter],
  );

  // Demand-load more pages for the active lane
  useEffect(() => {
    if (!address || !node) return undefined;
    if (!hasMore || loading) return undefined;
    if (scanning && historySource === 'node') return undefined;

    if (historyFilter === 'all' || typeFiltersSupported) {
      // Server-filtered lane or unfiltered: load until we have enough rows for the UI page
      if (filteredHistory.length >= matchesNeededForPage) return undefined;
      if (scanning) return undefined;
      void loadMoreHistory(address, node, {
        filter: activeLane,
        minLoaded: matchesNeededForPage,
      });
      return undefined;
    }

    // Legacy client hunt only when indexer has no type/group/direction filters
    if (filteredHistory.length >= matchesNeededForPage) return undefined;
    if (scanning) return undefined;
    void loadMoreHistory(address, node, {
      filter: 'all',
      untilMatchCount: matchesNeededForPage,
      matchFn,
      maxPages: INDEXER_FILTER_MAX_PAGES,
      concurrency: INDEXER_FILTER_CONCURRENCY,
    });
    return undefined;
  }, [
    address,
    node,
    hasMore,
    loading,
    scanning,
    historySource,
    historyFilter,
    typeFiltersSupported,
    activeLane,
    allHistory.length,
    filteredHistory.length,
    matchesNeededForPage,
    matchFn,
  ]);

  const handleFilterChange = (id) => {
    setHistoryFilter(id);
    setCurrentPage(1);
  };

  const handleNext = () => {
    setCurrentPage((p) => p + 1);
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
  const currentHistory = filteredHistory.slice(startIndex, endIndex);
  // Next enabled if more filtered rows exist, or cache still has unfetched history
  const hasNext = endIndex < filteredHistory.length || hasMore;

  const isBusy = loading || scanning;
  /** Actively loading more pages to fill this filter page (not a full-history scan) */
  const isFilterSearching =
    historyFilter !== 'all'
    && !error
    && hasMore
    && filteredHistory.length < matchesNeededForPage
    && isBusy;

  const showEmptyAll =
    !isBusy && !error && allHistory.length === 0 && !hasMore && historyFilter === 'all';
  const showEmptyFilter =
    !isBusy
    && !error
    && !isFilterSearching
    && filteredHistory.length === 0
    && historyFilter !== 'all'
    && !hasMore;

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
                  <span className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1 cursor-default">
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
                                className="break-all cursor-pointer hover:text-[#E79300] hover:underline font-mono"
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
              className={`inline-block w-2 h-2 rounded-full ${isBusy ? 'bg-yellow-400 animate-pulse' : 'bg-green-500'}`}
              title={
                scanning
                  ? `${historySource === 'indexer' ? 'Indexer' : 'Node'} loading… ${allHistory.length} txs (${pagesScanned} pages)`
                  : loading
                    ? 'Loading…'
                    : historySource === 'indexer'
                      ? `Indexer · ${allHistory.length} loaded${hasMore ? ' (more on demand)' : ''}`
                      : 'Up to date'
              }
            />
            {isBusy && (
              <span className="text-[10px] font-normal text-zinc-500 normal-case tracking-normal">
                {historySource === 'indexer' ? 'Indexer' : 'Node'}
                {' · '}
                {allHistory.length.toLocaleString()} loaded
                {isTestnet ? ' · testnet' : ''}
              </span>
            )}
            {!isBusy && historySource === 'indexer' && allHistory.length > 0 && (
              <span className="text-[10px] font-normal text-zinc-500 normal-case tracking-normal">
                Indexer · {allHistory.length.toLocaleString()} loaded
                {hasMore ? '+' : ''}
              </span>
            )}
          </h2>
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5 mt-3 mb-4 pb-1"
          role="tablist"
          aria-label="History filter"
        >
          {HISTORY_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={historyFilter === f.id}
              className={`compact-btn !mx-0 !my-0 !px-3 !py-1${historyFilter === f.id ? ' compact-btn--active' : ''}`}
              onClick={() => handleFilterChange(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error && allHistory.length === 0 && (
          <div className="error"><strong>Error:</strong> {error}</div>
        )}
        {isFilterSearching && (
          <p className="text-zinc-400 text-sm mb-3">
            {typeFiltersSupported
              ? `Loading ${filterLabel.toLowerCase()} from indexer…`
              : `Searching history for ${filterLabel.toLowerCase()}…`}
            <span className="text-zinc-500">
              {' '}
              ({filteredHistory.length.toLocaleString()}
              {typeFiltersSupported ? ' loaded' : ' matches'}
              {historySource === 'indexer' && typeFiltersSupported
                ? ' · group/direction filter'
                : historySource === 'indexer'
                  ? ` · client scan ×${INDEXER_FILTER_CONCURRENCY}`
                  : ''})
            </span>
          </p>
        )}
        {!isFilterSearching && isBusy && historyFilter === 'all' && (
          <p className="text-zinc-500 text-xs mb-3">
            {historySource === 'indexer' ? 'Loading from indexer…' : 'Loading from node…'}
            {' '}
            {allHistory.length > 0
              ? `${allHistory.length.toLocaleString()} so far`
              : ''}
          </p>
        )}
        {showEmptyAll && <p>No transactions found.</p>}
        {showEmptyFilter && (
          <p className="text-zinc-400 text-sm mb-3">{filterEmptyMessage(historyFilter)}</p>
        )}

        {currentHistory.length > 0 && (
          <div style={{ maxHeight: '420px', overflowY: 'auto', paddingRight: '10px' }}>
            {isFilterSearching && (
              <p className="text-zinc-500 text-xs mb-2">
                Showing {currentHistory.length} so far — loading more pages for matches…
              </p>
            )}
            {currentHistory.map((tx, index) => {
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
                  key={`${asDisplayString(tx.txid, 'tx')}-${startIndex + index}`}
                  style={{
                    backgroundColor: txBackground,
                    border: `1px solid ${txBorder}`,
                    borderRadius: '8px',
                    padding: '14px 16px',
                    marginBottom: '14px',
                    color: txColor,
                  }}
                >
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
                        textTransform: 'uppercase',
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

                  {tx.description && (
                    <div style={{ marginBottom: '8px', fontSize: '13px', opacity: 0.95 }}>
                      {tx.description}
                    </div>
                  )}

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

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
                    <strong style={{ color: labelColor, minWidth: 42 }}>Amount:</strong>
                    <span style={{ fontFamily: 'monospace' }}>
                      {tx.amount} <span style={{ opacity: 0.7 }}>{tx.asset}</span>
                    </span>
                  </div>

                  {tx.fee && tx.fee !== '0' && tx.type !== 'reward' && tx.type !== 'match' && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
                      <strong style={{ color: labelColor, minWidth: 42 }}>Fee:</strong>
                      <span style={{ fontFamily: 'monospace' }}>{tx.fee} WART</span>
                    </div>
                  )}

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
            disabled={currentPage === 1}
          >
            Previous
          </button>
          <button
            type="button"
            className="compact-btn"
            onClick={handleNext}
            disabled={!hasNext}
          >
            Next
          </button>
        </div>
      </section>
    </>
  );
};

export default TransactionHistory;
