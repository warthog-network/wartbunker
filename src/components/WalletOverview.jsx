import React, { useEffect, useMemo, useState, Fragment } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import ConfirmDialog from './ConfirmDialog';
import { isValidAssetHash } from '../utils/warthogFormat';
import { createWarthogApi, getNodeData } from '../utils/warthogClient.js';
import {
  bumpNonceAfterSuccess,
  cancelLimitOrder,
  getSmartNonce,
} from '../utils/cancelLimitOrder.js';

const WalletOverview = ({ onLogout }) => {
  const {
    wallet,
    balance,
    usdBalance,
    selectedNode,
    setCurrentTab,
    setSendAssetPrefill,
    setDexPoolPrefill,
    isTestnetNode,
    refreshBalance,
    assetBalances,
    watchedAssets,
    fetchAssetBalance,
    addWatchedAsset,
    removeWatchedAsset,
    reorderWatchedAssets,
    overviewLiquidityPositions,
    setOverviewLiquidityPositions,
    overviewLiquidityExpanded,
    setOverviewLiquidityExpanded,
    currentWalletName,
    nextNonce,
    isSessionLocked,
    isSigningUnlocked,
  } = useWallet();

  const toast = useToast();

  const [manualAssetHash, setManualAssetHash] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [dragAssetIndex, setDragAssetIndex] = useState(null);
  const [dropAssetIndex, setDropAssetIndex] = useState(null);

  const orderedAssets = useMemo(() => {
    if (!watchedAssets.length) return assetBalances;
    const byHash = new Map(assetBalances.map((a) => [a.hash.toLowerCase(), a]));
    const ordered = watchedAssets
      .map((w) => byHash.get(w.hash.toLowerCase()))
      .filter(Boolean);
    const watchedSet = new Set(watchedAssets.map((w) => w.hash.toLowerCase()));
    const extras = assetBalances.filter((a) => !watchedSet.has(a.hash.toLowerCase()));
    return [...ordered, ...extras];
  }, [watchedAssets, assetBalances]);

  const trackedAssetHashKey = useMemo(
    () => orderedAssets.map((asset) => asset.hash?.toLowerCase()).filter(Boolean).join(','),
    [orderedAssets],
  );

  // NEW: Open Limit Orders state
  const [openOrders, setOpenOrders] = useState(null);
  const [loadingOpenOrders, setLoadingOpenOrders] = useState(false);
  const [openOrdersExpanded, setOpenOrdersExpanded] = useState(false);
  const [collapsedAssetGroups, setCollapsedAssetGroups] = useState(() => new Set());
  const [loadingLiquidityPositions, setLoadingLiquidityPositions] = useState(false);
  const [cancellingOrderHash, setCancellingOrderHash] = useState(null);
  const [cancelConfirm, setCancelConfirm] = useState(null);

  const trimBalanceDisplay = (value) => {
    const s = value == null ? '0' : String(value);
    if (!s.includes('.')) return s;
    return s.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1') || '0';
  };

  const hasPositiveBalance = (balanceInfo) => {
    if (!balanceInfo) return false;
    if (balanceInfo.str != null) {
      const amount = parseFloat(balanceInfo.str);
      return Number.isFinite(amount) && amount > 0;
    }
    if (balanceInfo.u64 != null) {
      try {
        return BigInt(balanceInfo.u64) > 0n;
      } catch {
        return Number(balanceInfo.u64) > 0;
      }
    }
    if (balanceInfo.E8 != null) return Number(balanceInfo.E8) > 0;
    return false;
  };

  const assetGroupKey = (asset) => (asset?.hash || String(asset?.id ?? '')).toLowerCase();

  const toggleAssetGroup = (asset) => {
    const key = assetGroupKey(asset);
    if (!key) return;
    setCollapsedAssetGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAllAssetGroups = () => setCollapsedAssetGroups(new Set());

  const collapseAllAssetGroups = (ordersData) => {
    if (!Array.isArray(ordersData)) return;
    setCollapsedAssetGroups(
      new Set(ordersData.map((assetOrder) => assetGroupKey(assetOrder.baseAsset)).filter(Boolean)),
    );
  };

  const copyToClipboard = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Copied to clipboard');
    }).catch(() => {
      toast.error('Failed to copy to clipboard');
    });
  };

  const abbreviateAddress = (address) => {
    if (!address) return '';
    if (address.length <= 11) return address;
    return `${address.slice(0, 5)}…${address.slice(-5)}`;
  };

  const enrichOpenOrders = async (ordersData) => {
    const { formatLimitPrice } = await import('../utils/warthogFormat.js');
    if (ordersData?.code !== 0 || !Array.isArray(ordersData.data)) return ordersData;

    const data = await Promise.all(ordersData.data.map(async (assetOrder) => {
      const decimals = assetOrder.baseAsset?.decimals ?? 8;
      const enrichOrderList = async (orders) => Promise.all(
        (orders || []).map(async (order) => ({
          ...order,
          formattedLimitPrice: await formatLimitPrice(order.limit, decimals),
        })),
      );

      return {
        ...assetOrder,
        wartToAssetSwaps: await enrichOrderList(assetOrder.wartToAssetSwaps),
        assetToWartSwaps: await enrichOrderList(assetOrder.assetToWartSwaps),
      };
    }));

    return { ...ordersData, data };
  };

  const handleFetchManualAsset = async () => {
    if (!isValidAssetHash(manualAssetHash)) {
      toast.error('Please enter a valid asset hash (64 hex characters)');
      return;
    }

    setIsFetching(true);
    try {
      await fetchAssetBalance(manualAssetHash);
      // Persist it so it survives refresh / reload
      addWatchedAsset(manualAssetHash);
      setManualAssetHash('');
      toast.success('Asset added to your wallet');
    } catch (err) {
      toast.error('Failed to fetch asset balance');
    }
    setIsFetching(false);
  };

  // ==================== FETCH OPEN LIMIT ORDERS ====================
  const fetchOpenOrders = async ({ expand = true, silent = false } = {}) => {
    if (!wallet?.address) {
      if (!silent) toast.error('No wallet connected');
      return;
    }

    setLoadingOpenOrders(true);
    try {
      const api = await createWarthogApi(selectedNode);
      const res = await api.getOpenOrders(wallet.address);
      const ordersData = res.success
        ? { code: 0, data: res.data }
        : { code: res.code, error: res.error };
      const enriched = await enrichOpenOrders(ordersData);
      setOpenOrders(enriched);
      if (expand) {
        collapseAllAssetGroups(enriched?.data);
        setOpenOrdersExpanded(true);
      }
    } catch (err) {
      console.error(err);
      if (!silent) toast.error('Failed to fetch open orders: ' + err.message);
    }
    setLoadingOpenOrders(false);
  };

  const handleOpenOrdersToggle = () => {
    if (openOrdersExpanded) {
      setOpenOrdersExpanded(false);
      return;
    }
    if (openOrders) {
      collapseAllAssetGroups(openOrders.data);
      setOpenOrdersExpanded(true);
      return;
    }
    fetchOpenOrders();
  };

  const fetchLiquidityPositions = async ({ expand = true, silent = false } = {}) => {
    if (!wallet?.address) {
      if (!silent) toast.error('No wallet connected');
      return;
    }
    if (!isTestnetNode(selectedNode)) {
      if (!silent) toast.error('Liquidity positions require a DeFi testnet node');
      return;
    }

    setLoadingLiquidityPositions(true);
    try {
      const api = await createWarthogApi(selectedNode);
      const { formatTokenBalance } = await import('../utils/warthogFormat.js');

      const hashSet = new Set();
      orderedAssets.forEach((asset) => {
        if (asset?.hash) hashSet.add(asset.hash.toLowerCase());
      });
      openOrders?.data?.forEach((assetOrder) => {
        const hash = assetOrder?.baseAsset?.hash;
        if (hash) hashSet.add(hash.toLowerCase());
      });

      const hashes = [...hashSet];
      if (!hashes.length) {
        setOverviewLiquidityPositions([]);
        if (expand) setOverviewLiquidityExpanded(true);
        return;
      }

      const positions = await Promise.all(
        hashes.map(async (hash) => {
          try {
            const [liquidityRes, marketRes] = await Promise.all([
              getNodeData(api, `account/${wallet.address}/balance/liquidity:${hash}`),
              getNodeData(api, `dex/market/${encodeURIComponent(hash)}`),
            ]);

            if (liquidityRes.code !== 0 || !liquidityRes.data) return null;

            const balanceData = liquidityRes.data;
            const tokenInfo = balanceData.token || balanceData.asset || {};
            const balanceInfo = balanceData.balance?.total || balanceData.balance || balanceData;
            if (!hasPositiveBalance(balanceInfo)) return null;

            const decimals = tokenInfo.decimals ?? 8;
            const lpBalance = trimBalanceDisplay(await formatTokenBalance(balanceInfo, decimals));

            const market = marketRes.code === 0 ? marketRes.data : null;
            const baseAsset = market?.baseAsset || market?.asset || orderedAssets.find(
              (asset) => asset.hash?.toLowerCase() === hash,
            ) || {};
            const pool = market?.liquidityPool || market?.liquidity || {};
            const assetName = baseAsset.name || tokenInfo.name || 'Asset';

            const formatReserve = (reserve) => {
              if (reserve?.str) return trimBalanceDisplay(reserve.str);
              return trimBalanceDisplay(reserve ?? '0');
            };

            return {
              hash,
              name: assetName,
              assetId: baseAsset.id,
              decimals,
              lpBalance,
              poolWart: formatReserve(pool.wart || pool.WART),
              poolAsset: formatReserve(pool.asset || pool[assetName]),
            };
          } catch {
            return null;
          }
        }),
      );

      setOverviewLiquidityPositions(positions.filter(Boolean));
      if (expand) setOverviewLiquidityExpanded(true);
    } catch (err) {
      console.error(err);
      if (!silent) toast.error('Failed to load liquidity positions: ' + err.message);
    } finally {
      setLoadingLiquidityPositions(false);
    }
  };

  useEffect(() => {
    if (!wallet?.address || !isTestnetNode(selectedNode)) return;
    fetchOpenOrders({ expand: false, silent: true });
  }, [wallet?.address, selectedNode]);

  useEffect(() => {
    if (!wallet?.address || !isTestnetNode(selectedNode)) return;
    fetchLiquidityPositions({ expand: false, silent: true });
  }, [wallet?.address, selectedNode, trackedAssetHashKey, openOrders?.data]);

  const handleLiquidityToggle = () => {
    if (overviewLiquidityExpanded) {
      setOverviewLiquidityExpanded(false);
      return;
    }
    if (overviewLiquidityPositions) {
      setOverviewLiquidityExpanded(true);
      return;
    }
    fetchLiquidityPositions();
  };
  const handleCancelOrder = async (order, direction, assetName) => {
    if (!isSigningUnlocked) {
      toast.error(isSessionLocked ? 'Unlock your wallet to cancel orders' : 'Wallet not loaded. Please log in again.');
      return;
    }
    if (!order?.txHash) {
      toast.error('Order is missing a transaction hash');
      return;
    }

    setCancellingOrderHash(order.txHash);
    try {
      const api = await createWarthogApi(selectedNode);
      const nonceId = getSmartNonce(wallet.address, nextNonce);
      const { nonce } = await cancelLimitOrder({
        api,
        txHash: order.txHash,
        accountAddress: wallet.address,
        nonceId,
      });
      bumpNonceAfterSuccess(wallet.address, nonce, nextNonce);
      toast.success(`${direction === 'buy' ? 'Buy' : 'Sell'} limit order cancel submitted`);
      await fetchOpenOrders();
      refreshBalance?.();
    } catch (err) {
      toast.error(err.message || 'Failed to cancel order');
    } finally {
      setCancellingOrderHash(null);
      setCancelConfirm(null);
    }
  };

  const requestCancelOrder = (order, direction, assetName) => {
    if (!isSigningUnlocked) {
      toast.error(isSessionLocked ? 'Unlock your wallet to cancel orders' : 'Wallet not loaded. Please log in again.');
      return;
    }
    setCancelConfirm({
      txHash: order.txHash,
      direction,
      assetName,
      order,
    });
  };

  // ============================================================

  // ==================== STYLIZED ORDER CARD RENDERER ====================
  const renderOrderCard = (order, direction, assetName, onCopy) => {
    const isBuy = direction === 'buy';
    const amountStr = order.amount?.str || '0';
    const filledStr = order.filled?.str || '0';
    const formattedPrice = order.formattedLimitPrice
      ?? (order.limit?.doubleAdjusted != null
        ? Number(order.limit.doubleAdjusted).toFixed(8)
        : '0.00000000');
    const amountNum = parseFloat(amountStr);
    const filledNum = parseFloat(filledStr);
    const fillPct = amountNum > 0 ? Math.min(100, Math.floor((filledNum / amountNum) * 100)) : 0;
    const isFullyFilled = fillPct >= 100;
    const isCancelling = cancellingOrderHash === order.txHash;

    return (
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-sm">
        <div className="flex justify-between items-start mb-2">
          <div>
            <span className={`inline-block text-[10px] font-mono px-2 py-px rounded ${isBuy ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
              {isBuy ? 'BUY' : 'SELL'}
            </span>
          </div>
          <div className="text-right">
            <span className="text-xs text-zinc-400">Limit Price</span>
            <div className="font-mono font-semibold text-white tabular-nums">
              {formattedPrice} <span className="text-xs text-zinc-400 font-normal">WART/{assetName}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs mb-2">
          <div>
            <span className="text-zinc-400">Amount</span>
            <div className="font-mono text-white font-medium tabular-nums">{amountStr} <span className="text-zinc-400">{assetName}</span></div>
          </div>
          <div className="text-right">
            <span className="text-zinc-400">Filled</span>
            <div className="font-mono text-white font-medium tabular-nums">{filledStr} <span className="text-zinc-400">{assetName}</span></div>
          </div>
        </div>

        {/* Fill Progress Bar */}
        <div className="mb-2">
          <div className="flex justify-between text-[10px] text-zinc-400 mb-px">
            <span>Fill Progress</span>
            <span className="tabular-nums">{fillPct}%</span>
          </div>
          <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all duration-300 ${isBuy ? 'bg-emerald-500' : 'bg-rose-500'}`}
              style={{ width: `${fillPct}%` }}
            />
          </div>
        </div>

        {/* Transaction Hash */}
        <div className="pt-2 border-t border-zinc-700 flex items-center gap-1.5 text-xs min-w-0">
          <span className="text-zinc-500 flex-shrink-0">Tx</span>
          <span
            onClick={() => onCopy(order.txHash)}
            className="font-mono text-purple-400 hover:text-purple-300 cursor-pointer truncate"
          >
            {order.txHash?.slice(0, 8)}…{order.txHash?.slice(-6)}
          </span>
        </div>

        {order.inMempool && (
          <div className="mt-1.5 text-[10px] text-yellow-400 flex items-center gap-1">
            <span>●</span> <span>In mempool (unconfirmed)</span>
          </div>
        )}

        <div className="mt-2 pt-2 border-t border-zinc-800 flex justify-end">
          <button
            type="button"
            onClick={() => requestCancelOrder(order, direction, assetName)}
            disabled={isFullyFilled || isCancelling || !order.txHash}
            className="compact-btn !text-red-400 hover:!text-red-300 !border-red-800/60 hover:!bg-red-950/50 disabled:opacity-40 disabled:cursor-not-allowed"
            title={isFullyFilled ? 'Fully filled orders cannot be canceled' : 'Cancel this limit order'}
          >
            {isCancelling ? 'Canceling…' : 'Cancel Order'}
          </button>
        </div>
      </div>
    );
  };
  // ============================================================

  if (!wallet) {
    return (
      <section>
        <p className="text-zinc-400 text-sm">Please log in to view your wallet.</p>
      </section>
    );
  }

  const balanceLoading = balance === null;

  return (
    <section className="!p-0 !bg-transparent !border-0 !shadow-none !mb-0">
      {/* Page header */}
      <div className="mb-5">
        <h2 className="!mb-1">Wallet Overview</h2>
        <p className="text-xs text-zinc-500">Your balances, assets, and open orders</p>
      </div>

      <div className="space-y-4">
        {/* Balance hero */}
        <div className="relative overflow-hidden rounded-2xl border border-zinc-700/80 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 min-w-0">
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-[#FDB913]/8 blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-28 h-28 rounded-full bg-orange-500/5 blur-2xl pointer-events-none" />

          <div className="relative p-5 min-w-0">
            <div className="mb-4 min-w-0">
              {currentWalletName && (
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 mb-2">
                  <span className="inline-block w-1 h-1 rounded-full bg-[#FDB913]/80 flex-shrink-0" />
                  <span>
                    Saved as{' '}
                    <span className="font-mono text-[#FDB913]">{currentWalletName}</span>
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 mb-1 min-w-0">
                <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-medium">
                  Total Balance
                </div>
                <button
                  onClick={refreshBalance}
                  className="refresh-balance-btn flex flex-shrink-0 items-center gap-1 px-2 py-1 text-[10px] font-medium text-zinc-400 bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-600/50 rounded-lg transition-colors !m-0"
                  title="Refresh balance"
                >
                  <span className="text-[#FDB913] text-[11px] leading-none">⟳</span>
                  Refresh
                </button>
              </div>
              <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
                {balanceLoading ? (
                  <div className="h-9 w-36 bg-zinc-800/80 rounded-lg animate-pulse" />
                ) : (
                  <span className="text-3xl font-semibold text-white tabular-nums tracking-tight break-all">
                    {balance}
                  </span>
                )}
                <span className="text-sm font-medium text-[#FDB913]">WART</span>
              </div>
              <div className="text-sm text-zinc-400 mt-1 tabular-nums">
                {balanceLoading ? (
                  <span className="inline-block h-4 w-20 bg-zinc-800/60 rounded animate-pulse" />
                ) : (
                  <>≈ ${usdBalance || '—'} USD</>
                )}
              </div>
            </div>

            <div className="flex flex-nowrap items-center gap-3 min-w-0">
              <button
                onClick={() => setCurrentTab('send')}
                className="flex-shrink-0 py-3 px-5 wallet-action-btn !m-0 font-semibold whitespace-nowrap"
              >
                Send WART
              </button>
              <div className="min-w-0 flex-1 flex justify-center overflow-hidden">
                <span
                  className="max-w-full truncate whitespace-nowrap font-mono text-[11px] text-zinc-400 hover:text-[#FDB913] cursor-pointer transition-colors text-center"
                  title={`${wallet.address} — click to copy`}
                  onClick={() => copyToClipboard(wallet.address)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      copyToClipboard(wallet.address);
                    }
                  }}
                >
                  <span className="sm:hidden">{abbreviateAddress(wallet.address)}</span>
                  <span className="hidden sm:inline">{wallet.address}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Your Assets */}
        <div className="bg-zinc-950 border border-zinc-700 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-zinc-900/80 border-b border-zinc-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-400">
                Your Assets
              </span>
              {orderedAssets.length > 0 && (
                <span className="text-[10px] px-2 py-0.5 bg-blue-500/10 text-blue-300 rounded-full font-mono border border-blue-500/20">
                  {orderedAssets.length}
                </span>
              )}
            </div>
            {orderedAssets.length > 1 && (
              <span className="text-[10px] text-zinc-500">Press and hold to reorder</span>
            )}
          </div>

          <div className="p-4">
            {orderedAssets.length > 0 ? (
              <div className="space-y-2 mb-4">
                {orderedAssets.map((asset, index) => (
                  <div
                    key={asset.hash || index}
                    draggable={orderedAssets.length > 1}
                    onDragStart={(e) => {
                      setDragAssetIndex(index);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(index));
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dropAssetIndex !== index) setDropAssetIndex(index);
                    }}
                    onDragLeave={() => {
                      if (dropAssetIndex === index) setDropAssetIndex(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const fromRaw = e.dataTransfer.getData('text/plain');
                      const from = dragAssetIndex ?? parseInt(fromRaw, 10);
                      if (Number.isFinite(from)) reorderWatchedAssets(from, index);
                      setDragAssetIndex(null);
                      setDropAssetIndex(null);
                    }}
                    onDragEnd={() => {
                      setDragAssetIndex(null);
                      setDropAssetIndex(null);
                    }}
                    className={`flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center sm:gap-3 p-3 rounded-xl bg-zinc-900/60 border transition-colors group min-w-0 overflow-hidden ${
                      dragAssetIndex === index
                        ? 'opacity-50 border-violet-500/50'
                        : dropAssetIndex === index
                          ? 'border-violet-500 bg-violet-950/20'
                          : 'border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 w-full sm:flex-1">
                      {orderedAssets.length > 1 && (
                        <button
                          type="button"
                          className="asset-drag-handle compact-btn compact-btn--square hover:!text-[#FDB913] !mx-0 !my-0 cursor-grab active:cursor-grabbing"
                          aria-label={`Press and hold to reorder ${asset.name}`}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <span className="grid grid-cols-3 gap-px" aria-hidden="true">
                            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((dot) => (
                              <span key={dot} className="w-0.5 h-0.5 rounded-full bg-current opacity-80" />
                            ))}
                          </span>
                        </button>
                      )}
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/80 to-cyan-500/60 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ring-1 ring-white/10">
                        {asset.name?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-white truncate">{asset.name}</div>
                        <span
                          onClick={() => copyToClipboard(asset.hash)}
                          className="text-[10px] text-zinc-500 font-mono truncate cursor-pointer block"
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              copyToClipboard(asset.hash);
                            }
                          }}
                        >
                          {asset.hash.slice(0, 8)}…{asset.hash.slice(-6)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 min-w-0 w-full sm:w-auto sm:flex-shrink-0 sm:max-w-[55%]">
                      <div
                        className="min-w-0 flex-1 font-mono text-xs sm:text-sm text-white tabular-nums truncate text-left sm:text-right"
                        title={`${asset.balance} ${asset.name}`}
                      >
                        {asset.balance}
                        <span className="text-[10px] text-zinc-400 ml-1">{asset.name}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isTestnetNode(selectedNode) && (
                          <button
                            type="button"
                            onClick={() => {
                              setSendAssetPrefill({
                                hash: asset.hash,
                                name: asset.name,
                                decimals: asset.decimals ?? 8,
                                balance: asset.balance,
                              });
                              setCurrentTab('send');
                            }}
                            className="compact-btn hover:!text-[#FDB913] !mx-0 !my-0 !px-3 !py-1 whitespace-nowrap"
                          >
                            Send Asset
                          </button>
                        )}
                        <button
                          onClick={() => removeWatchedAsset(asset.hash)}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="remove-token-btn flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-sm leading-none text-red-400/50 hover:bg-red-950/60 hover:text-red-400 transition-all"
                          title="Remove from wallet"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500 mb-4 text-center py-2">
                No custom tokens tracked yet
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t border-zinc-800">
              <input
                type="text"
                placeholder="Paste 64-char asset hash to track"
                className="input flex-1 font-mono text-sm !mb-0"
                value={manualAssetHash}
                onChange={(e) => setManualAssetHash(e.target.value.trim())}
                onKeyDown={(e) => e.key === 'Enter' && handleFetchManualAsset()}
              />
              <button
                type="button"
                onClick={handleFetchManualAsset}
                disabled={isFetching || !manualAssetHash}
                className="compact-btn hover:!text-[#FDB913] !mx-0 !my-0 !px-3 !py-1 w-full sm:w-auto flex-shrink-0"
              >
                {isFetching ? 'Adding…' : '+ Add Token'}
              </button>
            </div>
          </div>
        </div>

        {/* Open Limit Orders */}
        <div className="bg-zinc-950 border border-zinc-700 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-zinc-900/80 border-b border-zinc-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-purple-400">
                Open Limit Orders
              </span>
              {openOrders?.code === 0 && Array.isArray(openOrders.data) && (
                <span className="text-[10px] px-2 py-0.5 bg-purple-500/15 text-purple-300 rounded-full font-mono border border-purple-500/20">
                  {openOrders.data.length} asset{openOrders.data.length !== 1 ? 's' : ''}
                </span>
              )}
              {loadingOpenOrders && !openOrders && (
                <span className="text-[10px] px-2 py-0.5 bg-zinc-800 text-zinc-500 rounded-full font-mono border border-zinc-700">
                  …
                </span>
              )}
            </div>
          </div>

          <div className="p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={openOrdersExpanded ? () => fetchOpenOrders() : handleOpenOrdersToggle}
                disabled={loadingOpenOrders}
                className={`compact-btn hover:!text-[#FDB913] !mx-0 !my-0 !px-3 !py-1${
                  openOrdersExpanded ? ' compact-btn--active' : ''
                }`}
              >
                {loadingOpenOrders
                  ? 'Loading Open Orders…'
                  : openOrdersExpanded
                    ? '⟳ Refresh Open Orders'
                    : openOrders
                      ? 'View Open Orders'
                      : 'View My Open Limit Orders'}
              </button>
              {openOrdersExpanded && (
                <button
                  type="button"
                  onClick={() => setOpenOrdersExpanded(false)}
                  className="compact-btn hover:!text-[#FDB913] !mx-0 !my-0 !px-3 !py-1"
                >
                  Close
                </button>
              )}
            </div>

            {openOrders && openOrdersExpanded && (
              <div className="mt-4">
                {openOrders.code === 0 && Array.isArray(openOrders.data) && openOrders.data.length > 0 ? (
                  <div className="space-y-4">
                    {openOrders.data.length > 1 && (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={expandAllAssetGroups}
                          className="compact-btn hover:!text-[#FDB913] !mx-0 !my-0 !px-3 !py-1"
                        >
                          Show all assets
                        </button>
                        <button
                          type="button"
                          onClick={() => collapseAllAssetGroups(openOrders.data)}
                          className="compact-btn hover:!text-[#FDB913] !mx-0 !my-0 !px-3 !py-1"
                        >
                          Hide all assets
                        </button>
                      </div>
                    )}
                    {openOrders.data.map((assetOrder, idx) => {
                      const asset = assetOrder.baseAsset;
                      const buyOrders = assetOrder.wartToAssetSwaps || [];
                      const sellOrders = assetOrder.assetToWartSwaps || [];
                      const totalOrders = buyOrders.length + sellOrders.length;
                      const isGroupCollapsed = collapsedAssetGroups.has(assetGroupKey(asset));

                      return (
                        <div
                          key={asset.hash || asset.id || idx}
                          className="bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden"
                        >
                          <div
                            className={`px-4 py-3 bg-zinc-800/50 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
                              isGroupCollapsed ? '' : 'border-b border-zinc-700'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => toggleAssetGroup(asset)}
                              className="group flex items-start sm:items-center gap-3 min-w-0 w-full text-left !m-0 !p-0 !bg-transparent !border-0 hover:!bg-transparent hover:!transform-none hover:!shadow-none"
                              aria-expanded={!isGroupCollapsed}
                            >
                              <span
                                className="text-zinc-500 group-hover:text-zinc-400 text-xs w-3 flex-shrink-0 transition-colors mt-1 sm:mt-0"
                                aria-hidden="true"
                              >
                                {isGroupCollapsed ? '▸' : '▾'}
                              </span>
                              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 via-violet-500 to-fuchsia-500 flex items-center justify-center text-white font-bold text-xl shadow-inner ring-1 ring-white/20 flex-shrink-0">
                                {asset.name?.[0] || '?'}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="font-bold text-base sm:text-lg tracking-tight text-white group-hover:text-zinc-100 truncate transition-colors">
                                  {asset.name}
                                </div>
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-zinc-900/80 border border-zinc-700/60 text-[10px] text-zinc-400 font-mono tabular-nums group-hover:text-zinc-300 transition-colors">
                                    ID {asset.id}
                                  </span>
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-zinc-900/80 border border-zinc-700/60 text-[10px] text-zinc-400 font-mono tabular-nums group-hover:text-zinc-300 transition-colors">
                                    {asset.decimals} decimals
                                  </span>
                                  {totalOrders > 0 && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20 text-[10px] text-purple-300 font-mono tabular-nums group-hover:text-purple-200 transition-colors">
                                      {totalOrders} order{totalOrders !== 1 ? 's' : ''}
                                      {buyOrders.length > 0 && sellOrders.length > 0
                                        ? ` · ${buyOrders.length}B / ${sellOrders.length}S`
                                        : buyOrders.length > 0
                                          ? ' · buy'
                                          : ' · sell'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                            <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto justify-end">
                              <button
                                type="button"
                                onClick={() => copyToClipboard(asset.hash)}
                                title={`Copy asset hash: ${asset.hash}`}
                                className="compact-btn hover:!text-[#FDB913] !mx-0 !my-0 !px-3 !py-1 font-mono tabular-nums max-w-[calc(100%-4.5rem)] sm:max-w-none truncate"
                              >
                                {asset.hash?.slice(0, 8)}…{asset.hash?.slice(-6)}
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleAssetGroup(asset)}
                                className="compact-btn hover:!text-[#FDB913] !mx-0 !my-0 !px-3 !py-1 flex-shrink-0"
                              >
                                {isGroupCollapsed ? 'Show' : 'Hide'}
                              </button>
                            </div>
                          </div>

                          {!isGroupCollapsed && (
                          <div className="p-4 space-y-4">
                            {buyOrders.length > 0 && (
                              <div>
                                <div className="flex items-center gap-2 mb-2 px-1">
                                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
                                  <span className="uppercase tracking-[1.5px] text-xs font-semibold text-emerald-400">
                                    Buy Orders
                                  </span>
                                  <span className="text-xs text-emerald-400/50">({buyOrders.length})</span>
                                </div>
                                <div className="space-y-2">
                                  {buyOrders.map((order, oIdx) => (
                                    <Fragment key={order.txHash || `buy-${oIdx}-${asset.hash || ''}`}>
                                      {renderOrderCard(order, 'buy', asset.name, copyToClipboard)}
                                    </Fragment>
                                  ))}
                                </div>
                              </div>
                            )}

                            {sellOrders.length > 0 && (
                              <div>
                                <div className="flex items-center gap-2 mb-2 px-1">
                                  <span className="inline-block w-2 h-2 rounded-full bg-rose-400" />
                                  <span className="uppercase tracking-[1.5px] text-xs font-semibold text-rose-400">
                                    Sell Orders
                                  </span>
                                  <span className="text-xs text-rose-400/50">({sellOrders.length})</span>
                                </div>
                                <div className="space-y-2">
                                  {sellOrders.map((order, oIdx) => (
                                    <Fragment key={order.txHash || `sell-${oIdx}-${asset.hash || ''}`}>
                                      {renderOrderCard(order, 'sell', asset.name, copyToClipboard)}
                                    </Fragment>
                                  ))}
                                </div>
                              </div>
                            )}

                            {totalOrders === 0 && (
                              <div className="text-center py-3 text-xs text-zinc-500 italic">
                                No open orders for this asset
                              </div>
                            )}
                          </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : openOrders.code === 0 ? (
                  <div className="border border-zinc-800 rounded-xl p-8 text-center mt-4">
                    <div className="text-3xl mb-3 opacity-30">📭</div>
                    <p className="text-zinc-300 font-medium text-sm">No open limit orders</p>
                    <p className="text-xs text-zinc-500 mt-1 max-w-[260px] mx-auto">
                      Limit orders from the Warthog DEX will appear here with live fill progress.
                    </p>
                  </div>
                ) : (
                  <div className="bg-red-950/40 border border-red-900 rounded-xl p-4 text-center mt-4">
                    <p className="text-red-400 text-sm font-medium">Failed to load open orders</p>
                    <p className="text-xs text-red-400/70 mt-0.5">
                      API responded with code {openOrders.code}
                    </p>
                  </div>
                )}
              </div>
            )}

            {!openOrdersExpanded && (
              <p className="text-[11px] text-zinc-500 mt-3 text-center">
                {openOrders
                  ? 'Open orders are loaded — tap View to show them again.'
                  : 'Load pending buy/sell limit orders from the connected node.'}
              </p>
            )}
          </div>
        </div>

        {isTestnetNode(selectedNode) && (
          <div className="bg-zinc-950 border border-zinc-700 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 bg-zinc-900/80 border-b border-zinc-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400">
                  My Liquidity Positions
                </span>
                {overviewLiquidityPositions && (
                  <span className="text-[10px] px-2 py-0.5 bg-amber-500/15 text-amber-300 rounded-full font-mono border border-amber-500/20">
                    {overviewLiquidityPositions.length} pool{overviewLiquidityPositions.length !== 1 ? 's' : ''}
                  </span>
                )}
                {loadingLiquidityPositions && overviewLiquidityPositions == null && (
                  <span className="text-[10px] px-2 py-0.5 bg-zinc-800 text-zinc-500 rounded-full font-mono border border-zinc-700">
                    …
                  </span>
                )}
              </div>
            </div>

            <div className="p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={overviewLiquidityExpanded ? () => fetchLiquidityPositions() : handleLiquidityToggle}
                    disabled={loadingLiquidityPositions}
                    className={`compact-btn hover:!text-[#FDB913] !mx-0 !my-0 !px-3 !py-1${
                      overviewLiquidityExpanded ? ' compact-btn--active' : ''
                    }`}
                  >
                    {loadingLiquidityPositions
                      ? 'Loading Liquidity…'
                      : overviewLiquidityExpanded
                        ? '⟳ Refresh Liquidity'
                        : overviewLiquidityPositions
                          ? 'View Liquidity Positions'
                          : 'View My Liquidity Positions'}
                  </button>
                  {overviewLiquidityExpanded && (
                    <button
                      type="button"
                      onClick={() => setOverviewLiquidityExpanded(false)}
                      className="compact-btn hover:!text-[#FDB913] !mx-0 !my-0 !px-3 !py-1"
                    >
                      Close
                    </button>
                  )}
                </div>

                {overviewLiquidityPositions && overviewLiquidityExpanded && (
                  <div className="mt-4 space-y-3">
                    {overviewLiquidityPositions.length > 0 ? (
                      overviewLiquidityPositions.map((position) => (
                        <div
                          key={position.hash}
                          className="bg-zinc-900 border border-zinc-700 rounded-xl p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 via-orange-500 to-yellow-500 flex items-center justify-center text-white font-bold text-xl shadow-inner ring-1 ring-white/20 flex-shrink-0">
                                {position.name?.[0] || 'L'}
                              </div>
                              <div className="min-w-0">
                                <div className="font-bold text-lg tracking-tight text-white truncate">
                                  {position.name} <span className="text-amber-400/70 font-normal text-sm">LP</span>
                                </div>
                                <div className="text-[10px] text-zinc-500 font-mono">
                                  {position.assetId != null ? `ID ${position.assetId} · ` : ''}
                                  {position.decimals} decimals
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(position.hash)}
                              title={`Copy asset hash: ${position.hash}`}
                              className="compact-btn hover:!text-[#FDB913] !mx-0 !my-0 !px-3 !py-1 font-mono tabular-nums flex-shrink-0"
                            >
                              {position.hash?.slice(0, 8)}…{position.hash?.slice(-6)}
                            </button>
                          </div>

                          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                            <div className="bg-zinc-950/80 border border-amber-800/40 rounded-lg p-3">
                              <div className="text-[10px] uppercase tracking-wider text-amber-400/80 mb-1">
                                Your LP Shares
                              </div>
                              <div className="font-mono text-lg font-semibold text-white tabular-nums">
                                {position.lpBalance}
                              </div>
                            </div>
                            <div className="bg-zinc-950/80 border border-zinc-800 rounded-lg p-3">
                              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                                Pool WART
                              </div>
                              <div className="font-mono text-sm font-medium text-white tabular-nums">
                                {position.poolWart}
                              </div>
                            </div>
                            <div className="bg-zinc-950/80 border border-zinc-800 rounded-lg p-3">
                              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                                Pool {position.name}
                              </div>
                              <div className="font-mono text-sm font-medium text-white tabular-nums">
                                {position.poolAsset}
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 pt-3 border-t border-zinc-800 flex justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                setDexPoolPrefill({
                                  hash: position.hash,
                                  name: position.name,
                                });
                                setCurrentTab('dex');
                              }}
                              className="compact-btn hover:!text-[#FDB913] !mx-0 !my-0 !px-3 !py-1"
                            >
                              Manage in DEX
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="border border-zinc-800 rounded-xl p-6 text-center">
                        <p className="text-zinc-300 font-medium text-sm">No liquidity positions found</p>
                        <p className="text-xs text-zinc-500 mt-1 max-w-[280px] mx-auto">
                          LP shares appear here for tracked assets after you deposit into a pool on the DEX.
                        </p>
                      </div>
                    )}
                  </div>
                )}

              {!overviewLiquidityExpanded && (
                <p className="text-[11px] text-zinc-500 mt-3 text-center">
                  {overviewLiquidityPositions
                    ? 'Liquidity positions are loaded — tap View to show them again.'
                    : 'Load LP share balances for your tracked assets from the connected node.'}
                </p>
              )}
            </div>
          </div>
        )}

      </div>

      <button
        onClick={onLogout}
        className="px-4 py-2 text-sm font-medium text-red-400 border border-red-700/60 rounded-lg hover:bg-red-950/40 transition-colors mt-4"
      >
        Logout
      </button>

      <ConfirmDialog
        open={Boolean(cancelConfirm)}
        title="Cancel Limit Order"
        message={
          cancelConfirm
            ? `Cancel this ${cancelConfirm.direction === 'buy' ? 'buy' : 'sell'} limit order for ${cancelConfirm.assetName}?\n\nThis submits a cancelation transaction to the node. Unconfirmed orders may need a block mined before the cancel clears.`
            : ''
        }
        confirmText="Cancel Order"
        cancelText="Keep Order"
        confirmVariant="danger"
        onConfirm={() => {
          if (cancelConfirm) {
            handleCancelOrder(cancelConfirm.order, cancelConfirm.direction, cancelConfirm.assetName);
          }
        }}
        onCancel={() => setCancelConfirm(null)}
      />
    </section>
  );
};

export default WalletOverview;