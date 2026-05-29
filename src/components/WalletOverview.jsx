import React, { useState } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
// Removed old ConfirmDialog import (auto-mining no longer needs one-shot confirmation)
import axios from 'axios';

const API_URL = '/api/proxy';

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
    // Auto mining
    isAutoMining,
    autoMineCount,
    toggleAutoMining,
    isTestnetNode,
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

  const handleFetchManualAsset = async () => {
    if (!manualAssetHash || manualAssetHash.length < 60) {
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
      const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;
      const res = await axios.get(
        `${API_URL}?nodePath=account/${wallet.address}/open_orders&${nodeBaseParam}`
      );
      setOpenOrders(res.data);
    } catch (err) {
      console.error(err);
      toast.error('Failed to fetch open orders: ' + (err.response?.data?.message || err.message));
    }
    setLoadingOpenOrders(false);
  };
  // ============================================================

  // Note: Fake mining is now handled via toggleAutoMining() in context (continuous every 60s)

  // ==================== STYLIZED ORDER CARD RENDERER ====================
  const renderOrderCard = (order, direction, assetName, assetDecimals, onCopy) => {
    const isBuy = direction === 'buy';
    const amountStr = order.amount?.str || '0';
    const filledStr = order.filled?.str || '0';
    const price = order.limit?.doubleAdjusted ?? 0;
    const formattedPrice = price.toFixed(8);
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
    return <div>Please log in to view your wallet.</div>;
  }

  return (
    <>
      <section style={{ textAlign: 'left' }}>
      <h2 style={{ textAlign: 'left' }}>Wallet Overview</h2>

      {/* Address */}
      <div className="result" style={{ textAlign: 'left' }}>
        <p>
          <strong>Address:</strong>
          <span
            className="wallet-address"
            style={{
              display: 'block',
              textAlign: 'left',
              cursor: 'pointer',
              wordBreak: 'break-all',
              marginTop: '0.5rem',
            }}
            onClick={() => copyToClipboard(wallet.address)}
          >
            {wallet.address}
          </span>
        </p>
      </div>

      {/* WART Balance */}
      <div className="result" style={{ textAlign: 'left' }}>
        <p><strong>Balance:</strong> {balance !== null ? balance : 'Loading...'} WART</p>
        <p><strong>USD Value:</strong> ${usdBalance || 'N/A'}</p>
      </div>

      {/* Your Assets (Watched Tokens) */}
      <div className="result mt-4" style={{ textAlign: 'left' }}>
        <div className="flex items-center justify-between mb-3">
          <p className="font-semibold text-blue-400">Your Assets</p>
          {assetBalances.length > 0 && (
            <span className="text-xs text-zinc-500">{assetBalances.length} tracked</span>
          )}
        </div>

        {assetBalances.length > 0 ? (
          <div className="space-y-1">
            {assetBalances.map((asset, index) => (
              <div 
                key={index} 
                className="flex justify-between items-center py-2 border-t border-zinc-800 first:border-t-0 group"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{asset.name}</div>
                  <div className="text-[10px] text-zinc-500 font-mono truncate">
                    {asset.hash.slice(0, 8)}…{asset.hash.slice(-6)}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <div className="font-mono text-right text-sm">
                    {asset.balance} <span className="text-xs text-zinc-400">{asset.name}</span>
                  </div>
                  <button
                    onClick={() => removeWatchedAsset(asset.hash)}
                    className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-[10px] leading-none text-red-400/60 hover:bg-red-950 hover:text-red-400 transition-all"
                    title="Remove from wallet"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-zinc-500 py-2">
            No custom tokens tracked yet.<br />
            Use the box below to add asset hashes you care about.
          </div>
        )}
      </div>

      {/* === MANUAL ASSET FETCH SECTION === */}
      <div className="result mt-4" style={{ textAlign: 'left' }}>
        <p className="font-semibold mb-2 text-orange-400">Add Token to Wallet</p>
        
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Paste 64-char asset hash"
            className="input flex-1 font-mono text-sm"
            value={manualAssetHash}
            onChange={(e) => setManualAssetHash(e.target.value.trim())}
            onKeyDown={(e) => e.key === 'Enter' && handleFetchManualAsset()}
          />
          <button 
            onClick={handleFetchManualAsset} 
            disabled={isFetching || !manualAssetHash}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl disabled:opacity-50"
          >
            {isFetching ? 'Fetching...' : 'Fetch'}
          </button>
        </div>
        
        <p className="text-xs text-zinc-500 mt-1">
          Adding a token here will save it to your wallet. It will reload automatically next time you log in.
        </p>
      </div>

      {/* ==================== OPEN LIMIT ORDERS (STYLIZED) ==================== */}
      <div className="result mt-4" style={{ textAlign: 'left' }}>
        <p className="font-semibold mb-2 text-purple-400 flex items-center gap-2">
          <span>My Open Limit Orders</span>
          {openOrders && openOrders.data && Array.isArray(openOrders.data) && (
            <span className="text-xs px-2.5 py-0.5 bg-purple-500/20 text-purple-300 rounded-full font-mono">
              {openOrders.data.length} asset{openOrders.data.length !== 1 ? 's' : ''}
            </span>
          )}
        </p>
        
        <button
          onClick={fetchOpenOrders}
          disabled={loadingOpenOrders}
          className="w-full py-3 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white font-semibold rounded-2xl disabled:opacity-60 transition-all mb-3 flex items-center justify-center gap-2"
        >
          {loadingOpenOrders ? (
            'Loading Open Orders...'
          ) : openOrders ? (
            '⟳ Refresh Open Orders'
          ) : (
            'View My Open Limit Orders'
          )}
        </button>

        {openOrders && (
          <div>
            {openOrders.code === 0 && Array.isArray(openOrders.data) && openOrders.data.length > 0 ? (
              <div className="space-y-4">
                {openOrders.data.map((assetOrder, idx) => {
                  const asset = assetOrder.baseAsset;
                  const buyOrders = assetOrder.wartToAssetSwaps || [];   // WART → Asset = Buy orders
                  const sellOrders = assetOrder.assetToWartSwaps || [];  // Asset → WART = Sell orders
                  const totalOrders = buyOrders.length + sellOrders.length;

                  return (
                    <div key={idx} className="bg-zinc-950 border border-zinc-700 rounded-2xl overflow-hidden shadow-sm">
                      {/* Asset Header */}
                      <div className="px-4 py-3 bg-zinc-900/90 border-b border-zinc-700 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 via-violet-500 to-fuchsia-500 flex items-center justify-center text-white font-bold text-xl shadow-inner ring-1 ring-white/20">
                            {asset.name?.[0] || '?'}
                          </div>
                          <div>
                            <div className="font-bold text-xl tracking-[-0.5px] text-white">{asset.name}</div>
                            <div className="text-[10px] text-zinc-500 font-mono -mt-0.5">Asset ID {asset.id} • {asset.decimals} decimals</div>
                          </div>
                        </div>
                        <div 
                          onClick={() => copyToClipboard(asset.hash)}
                          className="text-right cursor-pointer group"
                        >
                          <div className="text-xs font-mono text-zinc-400 group-hover:text-purple-400 transition-colors">
                            {asset.hash?.slice(0, 8)}…{asset.hash?.slice(-6)}
                          </div>
                          <div className="text-[10px] text-zinc-500 group-hover:text-zinc-400">Asset Hash ↗</div>
                        </div>
                      </div>

                      <div className="p-4 space-y-4">
                        {/* BUY ORDERS */}
                        {buyOrders.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-2 px-1">
                              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
                              <span className="uppercase tracking-[1.5px] text-xs font-semibold text-emerald-400">Buy Orders</span>
                              <span className="text-xs text-emerald-400/50">({buyOrders.length})</span>
                            </div>
                            <div className="space-y-2">
                              {buyOrders.map((order, oIdx) => renderOrderCard(order, 'buy', asset.name, asset.decimals, copyToClipboard))}
                            </div>
                          </div>
                        )}

                        {/* SELL ORDERS */}
                        {sellOrders.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-2 px-1">
                              <span className="inline-block w-2 h-2 rounded-full bg-rose-400"></span>
                              <span className="uppercase tracking-[1.5px] text-xs font-semibold text-rose-400">Sell Orders</span>
                              <span className="text-xs text-rose-400/50">({sellOrders.length})</span>
                            </div>
                            <div className="space-y-2">
                              {sellOrders.map((order, oIdx) => renderOrderCard(order, 'sell', asset.name, asset.decimals, copyToClipboard))}
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
              <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-8 text-center">
                <div className="text-4xl mb-3 opacity-40">📭</div>
                <p className="text-zinc-300 font-medium">No open limit orders</p>
                <p className="text-xs text-zinc-500 mt-1 max-w-[260px] mx-auto">
                  When you place limit orders on the Warthog DEX, they will appear here with live fill progress.
                </p>
              </div>
            ) : (
              <div className="bg-red-950/40 border border-red-900 rounded-2xl p-4 text-center">
                <p className="text-red-400 text-sm font-medium">Failed to load open orders</p>
                <p className="text-xs text-red-400/70 mt-0.5">API responded with code {openOrders.code}</p>
              </div>
            )}
          </div>
        )}

        {!openOrders && (
          <p className="text-xs text-gray-500 px-1">
            Click above to load your pending buy/sell limit orders from the connected node.
          </p>
        )}
      </div>
      {/* ============================================================ */}

      {/* ==================== AUTO FAKE MINING (Testnet) ==================== */}
      <div className="result mt-4" style={{ textAlign: 'left' }}>
        <p className="font-semibold mb-3 text-emerald-400 flex items-center justify-between">
          <span>Testnet Auto-Miner</span>
          {isAutoMining && (
            <span className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full">
              ACTIVE
            </span>
          )}
        </p>

        <button
          onClick={toggleAutoMining}
          disabled={!isTestnetNode(selectedNode)}
          className={`w-full py-3 font-semibold rounded-2xl transition-all flex items-center justify-center gap-2 ${
            isAutoMining
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isAutoMining ? (
            <>⏹ Stop Auto-Mining ({autoMineCount} mined)</>
          ) : (
            <>⛏️ Start Auto-Mining (every 20s)</>
          )}
        </button>

        <div className="mt-2 text-xs">
          {isTestnetNode(selectedNode) ? (
            isAutoMining ? (
              <span className="text-emerald-400">Mining is running in the background. Balance refreshes automatically.</span>
            ) : (
              <span className="text-zinc-500">Turn on to repeatedly call the debug fakemine endpoint every 20 seconds.</span>
            )
          ) : (
            <span className="text-amber-400">Auto-mining is only available when connected to a testnet or localhost node.</span>
          )}
        </div>
      </div>
      {/* ======================================================== */}

      {/* Action Buttons */}
      <div className="flex gap-3 mt-4">
        <button onClick={refreshBalance}>Refresh Balance</button>
        <button onClick={() => setCurrentTab('send')}>
          Send Transaction
        </button>
      </div>

      {/* Network Info */}
      <div className="result mt-4" style={{ textAlign: 'left' }}>
        <p><strong>Current Node:</strong> {selectedNode}</p>
        <p><strong>Pin Height:</strong> {pinHeight}</p>
        <p><strong>Pin Hash:</strong> {pinHash}</p>
      </div>

      <button 
        onClick={onLogout}
        className="px-4 py-2 text-sm font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 dark:text-red-400 dark:border-red-700 transition-colors mt-4"
      >
        Logout
      </button>
    </section>
    </>
  );
};

export default WalletOverview;