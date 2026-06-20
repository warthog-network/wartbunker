import React, { useState, Fragment } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import { isValidAssetHash } from '../utils/warthogFormat';
import { createWarthogApi } from '../utils/warthogClient.js';

const WalletOverview = ({ onLogout }) => {
  const {
    wallet,
    balance,
    usdBalance,
    pinHeight,
    pinHash,
    selectedNode,
    setCurrentTab,
    refreshBalance,
    assetBalances,
    fetchAssetBalance,
    addWatchedAsset,
    removeWatchedAsset,
    currentWalletName,
  } = useWallet();

  const toast = useToast();

  const [manualAssetHash, setManualAssetHash] = useState('');
  const [isFetching, setIsFetching] = useState(false);

  // NEW: Open Limit Orders state
  const [openOrders, setOpenOrders] = useState(null);
  const [loadingOpenOrders, setLoadingOpenOrders] = useState(false);

  const copyToClipboard = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Copied to clipboard');
    }).catch(() => {
      toast.error('Failed to copy to clipboard');
    });
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
  const fetchOpenOrders = async () => {
    if (!wallet?.address) {
      toast.error('No wallet connected');
      return;
    }

    setLoadingOpenOrders(true);
    try {
      const api = await createWarthogApi(selectedNode);
      const res = await api.getOpenOrders(wallet.address);
      const ordersData = res.success
        ? { code: 0, data: res.data }
        : { code: res.code, error: res.error };
      setOpenOrders(await enrichOpenOrders(ordersData));
    } catch (err) {
      console.error(err);
      toast.error('Failed to fetch open orders: ' + err.message);
    }
    setLoadingOpenOrders(false);
  };
  // ============================================================

  // ==================== STYLIZED ORDER CARD RENDERER ====================
  const renderOrderCard = (order, direction, assetName, assetDecimals, onCopy) => {
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
        <div className="pt-2 border-t border-zinc-700 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-zinc-500 flex-shrink-0">Tx</span>
            <span 
              onClick={() => onCopy(order.txHash)}
              className="font-mono text-purple-400 hover:text-purple-300 cursor-pointer truncate"
            >
              {order.txHash?.slice(0, 8)}…{order.txHash?.slice(-6)}
            </span>
          </div>
          <button 
            onClick={() => onCopy(order.txHash)}
            className="text-purple-400 hover:text-white active:text-purple-300 px-2 py-0.5 rounded hover:bg-purple-500/10 text-xs font-medium transition-colors"
          >
            COPY
          </button>
        </div>

        {order.inMempool && (
          <div className="mt-1.5 text-[10px] text-yellow-400 flex items-center gap-1">
            <span>●</span> <span>In mempool (unconfirmed)</span>
          </div>
        )}
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
        {currentWalletName ? (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#FDB913]/80" />
            <span>
              Saved as{' '}
              <span className="font-mono text-[#FDB913]">{currentWalletName}</span>
            </span>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">Your balances, assets, and open orders</p>
        )}
      </div>

      <div className="space-y-4">
        {/* Balance hero */}
        <div className="relative overflow-hidden rounded-2xl border border-zinc-700/80 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950">
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-[#FDB913]/8 blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-28 h-28 rounded-full bg-orange-500/5 blur-2xl pointer-events-none" />

          <div className="relative p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-medium mb-1">
                  Total Balance
                </div>
                <div className="flex items-baseline gap-2">
                  {balanceLoading ? (
                    <div className="h-9 w-36 bg-zinc-800/80 rounded-lg animate-pulse" />
                  ) : (
                    <span className="text-3xl font-semibold text-white tabular-nums tracking-tight">
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
              <button
                onClick={refreshBalance}
                className="refresh-balance-btn flex flex-shrink-0 items-center gap-1 px-2 py-1 text-[10px] font-medium text-zinc-400 bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-600/50 rounded-lg transition-colors !m-0"
                title="Refresh balance"
              >
                <span className="text-[#FDB913] text-[11px] leading-none">⟳</span>
                Refresh
              </button>
            </div>

            <button
              onClick={() => setCurrentTab('send')}
              className="w-full py-3 wallet-action-btn !m-0 font-semibold"
            >
              Send WART
            </button>
          </div>
        </div>

        {/* Address */}
        <div className="bg-zinc-950 border border-zinc-700 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-zinc-900/80 border-b border-zinc-700">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Wallet Address
            </span>
          </div>
          <div className="p-4">
            <span
              className="wallet-address block cursor-pointer hover:opacity-90 transition-opacity"
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
              {wallet.address}
            </span>
            <p className="text-[10px] text-zinc-500 mt-2">Click to copy</p>
          </div>
        </div>

        {/* Your Assets */}
        <div className="bg-zinc-950 border border-zinc-700 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-zinc-900/80 border-b border-zinc-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-400">
                Your Assets
              </span>
              {assetBalances.length > 0 && (
                <span className="text-[10px] px-2 py-0.5 bg-blue-500/10 text-blue-300 rounded-full font-mono border border-blue-500/20">
                  {assetBalances.length}
                </span>
              )}
            </div>
          </div>

          <div className="p-4">
            {assetBalances.length > 0 ? (
              <div className="space-y-2">
                {assetBalances.map((asset, index) => (
                  <div
                    key={asset.hash || index}
                    className="flex justify-between items-center gap-3 p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 transition-colors group"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/80 to-cyan-500/60 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ring-1 ring-white/10">
                        {asset.name?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-white truncate">{asset.name}</div>
                        <div className="text-[10px] text-zinc-500 font-mono truncate">
                          {asset.hash.slice(0, 8)}…{asset.hash.slice(-6)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="font-mono text-right text-sm text-white tabular-nums">
                        {asset.balance}
                        <span className="text-[10px] text-zinc-400 ml-1">{asset.name}</span>
                      </div>
                      <button
                        onClick={() => removeWatchedAsset(asset.hash)}
                        className="remove-token-btn flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-sm leading-none text-red-400/50 hover:bg-red-950/60 hover:text-red-400 transition-all"
                        title="Remove from wallet"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 px-4">
                <div className="text-2xl mb-2 opacity-30">◎</div>
                <p className="text-sm text-zinc-400">No custom tokens tracked yet</p>
                <p className="text-xs text-zinc-500 mt-1">
                  Add an asset hash below to watch balances here.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Add Token */}
        <div className="bg-zinc-950 border border-zinc-700 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-zinc-900/80 border-b border-zinc-700">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-orange-400">
              Add Token
            </span>
          </div>
          <div className="p-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                placeholder="Paste 64-char asset hash"
                className="input flex-1 font-mono text-sm !mb-0"
                value={manualAssetHash}
                onChange={(e) => setManualAssetHash(e.target.value.trim())}
                onKeyDown={(e) => e.key === 'Enter' && handleFetchManualAsset()}
              />
              <button
                onClick={handleFetchManualAsset}
                disabled={isFetching || !manualAssetHash}
                className="w-full sm:w-auto px-5 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl disabled:opacity-50 font-medium transition-colors !m-0 flex-shrink-0"
              >
                {isFetching ? 'Fetching…' : 'Add Token'}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 mt-2.5 leading-relaxed">
              Tokens you add are saved to your wallet and reload automatically on next login.
            </p>
          </div>
        </div>

        {/* Open Limit Orders */}
        <div className="bg-zinc-950 border border-zinc-700 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-zinc-900/80 border-b border-zinc-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-purple-400">
                Open Limit Orders
              </span>
              {openOrders?.data && Array.isArray(openOrders.data) && (
                <span className="text-[10px] px-2 py-0.5 bg-purple-500/15 text-purple-300 rounded-full font-mono border border-purple-500/20">
                  {openOrders.data.length} asset{openOrders.data.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          <div className="p-4">
            <button
              onClick={fetchOpenOrders}
              disabled={loadingOpenOrders}
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white font-semibold rounded-xl disabled:opacity-60 transition-all flex items-center justify-center gap-2 !m-0"
            >
              {loadingOpenOrders
                ? 'Loading Open Orders…'
                : openOrders
                  ? '⟳ Refresh Open Orders'
                  : 'View My Open Limit Orders'}
            </button>

            {openOrders && (
              <div className="mt-4">
                {openOrders.code === 0 && Array.isArray(openOrders.data) && openOrders.data.length > 0 ? (
                  <div className="space-y-4">
                    {openOrders.data.map((assetOrder, idx) => {
                      const asset = assetOrder.baseAsset;
                      const buyOrders = assetOrder.wartToAssetSwaps || [];
                      const sellOrders = assetOrder.assetToWartSwaps || [];
                      const totalOrders = buyOrders.length + sellOrders.length;

                      return (
                        <div
                          key={asset.hash || asset.id || idx}
                          className="bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden"
                        >
                          <div className="px-4 py-3 bg-zinc-800/50 border-b border-zinc-700 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 via-violet-500 to-fuchsia-500 flex items-center justify-center text-white font-bold text-xl shadow-inner ring-1 ring-white/20">
                                {asset.name?.[0] || '?'}
                              </div>
                              <div>
                                <div className="font-bold text-lg tracking-tight text-white">{asset.name}</div>
                                <div className="text-[10px] text-zinc-500 font-mono">
                                  ID {asset.id} · {asset.decimals} decimals
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(asset.hash)}
                              className="text-right group !m-0 !p-0 !bg-transparent !border-0 hover:!bg-transparent"
                            >
                              <div className="text-xs font-mono text-zinc-400 group-hover:text-purple-400 transition-colors">
                                {asset.hash?.slice(0, 8)}…{asset.hash?.slice(-6)}
                              </div>
                              <div className="text-[10px] text-zinc-500 group-hover:text-zinc-400">Copy hash</div>
                            </button>
                          </div>

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
                                      {renderOrderCard(order, 'buy', asset.name, asset.decimals, copyToClipboard)}
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
                                      {renderOrderCard(order, 'sell', asset.name, asset.decimals, copyToClipboard)}
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

            {!openOrders && (
              <p className="text-[11px] text-zinc-500 mt-3 text-center">
                Load pending buy/sell limit orders from the connected node.
              </p>
            )}
          </div>
        </div>

        {/* Network status */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4">
          <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-medium mb-3">
            Network Status
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-800">
              <div className="text-[10px] text-zinc-500 mb-1">Node</div>
              <div className="text-xs font-mono text-zinc-300 break-all leading-snug">{selectedNode}</div>
            </div>
            <div className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-800">
              <div className="text-[10px] text-zinc-500 mb-1">Pin Height</div>
              <div className="text-sm font-mono text-white tabular-nums">{pinHeight ?? '—'}</div>
            </div>
            <div className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-800 sm:col-span-1">
              <div className="text-[10px] text-zinc-500 mb-1">Pin Hash</div>
              <div className="text-xs font-mono text-zinc-300 break-all leading-snug">{pinHash ?? '—'}</div>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={onLogout}
        className="px-4 py-2 text-sm font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 dark:text-red-400 dark:border-red-700 transition-colors mt-4"
      >
        Logout
      </button>
    </section>
  );
};

export default WalletOverview;