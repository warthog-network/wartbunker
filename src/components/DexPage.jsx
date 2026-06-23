import React, { useState, useEffect } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import {
  createWarthogApi,
  formatSubmitError,
  formatSubmitResult,
  getNodeData,
  signAndSubmitTransaction,
} from '../utils/warthogClient.js';
import {
  computePoolSpotPrice,
  formatAssetPrice,
} from '../utils/dexPrice.js';
import { DEFAULT_NODE_URL } from '../utils/presetNodes.js';
import { readPublicSession } from '../utils/sessionWallet.js';

const DexPage = ({ selectedNode: propSelectedNode, wallet: propWallet }) => {
  const {
    nextNonce: contextNextNonce,
    selectedNode: contextSelectedNode,
    isSigningUnlocked,
    isSessionLocked,
  } = useWallet();

  const selectedNode = propSelectedNode || contextSelectedNode || DEFAULT_NODE_URL;
  const wallet = propWallet || readPublicSession();

  const toast = useToast();

  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});
  const [activeTab, setActiveTab] = useState('market');
  const [liquidityMode, setLiquidityMode] = useState('deposit');

  useEffect(() => {
    if (activeTab === 'limit') {
      import('../utils/encodeLimitPrice.js').catch(() => {});
    }
  }, [activeTab]);

  // ==================== SAFE RENDER HELPERS ====================
  const safeStr = (v, fallback = '0') => {
    if (v == null) return fallback;
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (typeof v === 'object') {
      if (v.str != null) return String(v.str);
      if (v.E8 !== undefined) return (Number(v.E8) / 100000000).toFixed(8);
      if (v.u64 !== undefined) return String(v.u64);
      if (v.doubleAdjusted != null) return String(v.doubleAdjusted);
    }
    return fallback;
  };

  const safeRender = (v, fallback = '') => {
    if (v == null) return fallback;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    return fallback;
  };

  const formatBalance = (v) => {
    let s = safeStr(v, '0');
    if (typeof s !== 'string') s = String(s || '0');
    if (!s.includes('.')) return s;
    return s.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1') || '0';
  };

  // ==================== SMART NONCE HANDLING ====================
  const getSmartNonce = () => {
    if (!wallet?.address) return contextNextNonce ?? 0;

    const stored = localStorage.getItem(`warthogNextNonce_${wallet.address}`);
    const persistentNonce = stored ? Number(stored) : 0;

    return Math.max(persistentNonce, contextNextNonce ?? 0, 0);
  };

  const updateNonceAfterSuccess = (usedNonce) => {
    if (!wallet?.address) return;

    const newNonce = Math.max(getSmartNonce(), usedNonce + 1);
    localStorage.setItem(`warthogNextNonce_${wallet.address}`, newNonce);
  };

  const isNodeSuccess = (result) => {
    if (!result || result.error) return false;
    if (result.code !== undefined && result.code !== 0) return false;
    return true;
  };

  const getNodeError = (result) =>
    result?.error || result?.message || (result?.code != null ? `Node error (code ${result.code})` : null);

  const query = async (key, path, method = 'GET', data = null) => {
    setLoading(prev => ({ ...prev, [key]: true }));
    try {
      const api = await createWarthogApi(selectedNode);
      let result;
      if (method === 'POST') {
        const submitRes = await api.submitTransaction(data);
        result = submitRes.success
          ? { code: 0, data: submitRes.data }
          : { code: submitRes.code, error: submitRes.error };
      } else {
        result = await getNodeData(api, path);
      }
      setResults(prev => ({ ...prev, [key]: result }));
      return result;
    } catch (err) {
      const errorMsg = err.message;
      setResults(prev => ({ ...prev, [key]: { error: errorMsg } }));
      throw err;
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  const account = wallet?.address || '';

  // ==================== COPY TO CLIPBOARD ====================
  const copyToClipboard = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Copied to clipboard');
    }).catch(() => {});
  };

  // ==================== TRANSACTION RESULT CARD ====================
  const renderTransactionResult = (result, type) => {
    if (!result) return null;

    const isSuccess = isNodeSuccess(result);
    const txHash = result.data?.txHash || result.txHash || result.data?.hash || null;

    return (
      <div className={`mt-6 rounded-2xl border p-5 ${isSuccess ? 'bg-emerald-950/40 border-emerald-700' : 'bg-red-950/40 border-red-700'}`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-lg ${isSuccess ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
            {isSuccess ? '✓' : '!'}
          </div>
          <div>
            <div className={`font-semibold text-lg ${isSuccess ? 'text-emerald-400' : 'text-red-400'}`}>
              {isSuccess ? `${type} Submitted Successfully` : `${type} Failed`}
            </div>
            <div className="text-xs text-zinc-400">
              {isSuccess
                ? 'Transaction sent to node • Check History tab for confirmation'
                : (getNodeError(result) || 'The node rejected this transaction')}
            </div>
          </div>
        </div>

        {txHash && (
          <div className="mt-3 p-3 bg-zinc-950 rounded-xl border border-zinc-700">
            <div className="text-xs text-zinc-400 mb-1">Transaction Hash</div>
            <div 
              onClick={() => copyToClipboard(txHash)}
              className="font-mono text-sm text-emerald-400 break-all cursor-pointer hover:text-emerald-300"
            >
              {txHash}
            </div>
          </div>
        )}

        {result.error && (
          <div className="mt-3 text-sm text-red-400">
            {result.error}
          </div>
        )}
      </div>
    );
  };

  // ==================== STYLIZED POOL / MARKET CARD ====================
  const renderPoolMarketCard = (result) => {
    try {
      if (!result || result.code !== 0 || !result.data) {
        return (
          <div className="mt-4 p-4 bg-zinc-950 border border-zinc-700 rounded-2xl text-sm text-zinc-400">
            No pool/market data available.
          </div>
        );
      }

      const d = result.data;
      const asset = d.asset || d.baseAsset || d.market?.asset || {};
      const liquidity = d.liquidityPool || d.liquidity || d.reserves || d.poolReserves || d.pool || {};
      
      const wartReserve = safeStr(liquidity.wart || liquidity.WART, '0');
      const assetReserve = safeStr(liquidity.asset || liquidity[asset.name] || liquidity.assetE8, '0');
      
      const spotPrice = computePoolSpotPrice(d);
      let price = spotPrice != null ? formatAssetPrice(spotPrice) : '—';
      if (price === '—') {
        const priceRaw = d.price || d.spotPrice || d.doubleAdjustedPrice || d.marketPrice;
        price = safeStr(priceRaw, '—');
        if (price === '—' && priceRaw && typeof priceRaw === 'object') {
          price = priceRaw.doubleAdjusted != null ? String(priceRaw.doubleAdjusted) : price;
        }
      }
      
      return (
        <div className="mt-6 bg-zinc-950 border border-emerald-700/60 rounded-3xl overflow-hidden shadow-xl">
          <div className="px-6 py-5 bg-zinc-900 flex items-center justify-between border-b border-zinc-800">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-500 flex items-center justify-center text-white text-3xl font-bold shadow-inner ring-1 ring-white/20">
                {asset.name?.[0] || 'P'}
              </div>
              <div>
                <div className="text-3xl font-semibold tracking-[-1.5px] text-white">
                  {asset.name} <span className="text-emerald-400/60">/ WART</span>
                </div>
                <div className="font-mono text-[10px] text-zinc-500 -mt-1">
                  POOL • {asset.decimals || 8} decimals • Asset ID {asset.id || '—'}
                </div>
              </div>
            </div>
            
            {asset.hash && (
              <div 
                onClick={() => copyToClipboard(asset.hash)}
                className="text-right cursor-pointer group"
              >
                <div className="font-mono text-xs text-zinc-400 group-hover:text-emerald-400 transition-colors">
                  {asset.hash.slice(0, 10)}…{asset.hash.slice(-8)}
                </div>
                <div className="text-[10px] text-emerald-500/70 group-hover:text-emerald-400">Copy Asset Hash</div>
              </div>
            )}
          </div>

          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[1px] text-amber-400 mb-0.5">
                  <div className="w-1 h-1 rounded-full bg-amber-400"></div>
                  WART RESERVE
                </div>
                <div className="font-mono text-2xl sm:text-3xl md:text-[26px] leading-none font-semibold text-white tabular-nums tracking-[-1.5px]">
                  {formatBalance(wartReserve)}
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">WART</div>
              </div>

              <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[1px] text-emerald-400 mb-0.5">
                  <div className="w-1 h-1 rounded-full bg-emerald-400"></div>
                  {asset.name || 'ASSET'} RESERVE
                </div>
                <div className="font-mono text-2xl sm:text-3xl md:text-[26px] leading-none font-semibold text-white tabular-nums tracking-[-1.5px]">
                  {formatBalance(assetReserve)}
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">{asset.name || 'Asset'}</div>
              </div>

              <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 flex flex-col">
                <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[1px] text-violet-400 mb-0.5">
                  <div className="w-1 h-1 rounded-full bg-violet-400"></div>
                  SPOT PRICE
                </div>
                <div className="font-mono text-2xl sm:text-3xl md:text-[26px] leading-none font-semibold text-white tabular-nums tracking-[-1.5px] mt-auto">
                  {price}
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">WART per {asset.name || 'asset'}</div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-0.5 px-1 text-sm">
              {liquidity.shares && (
                <div>
                  <span className="text-emerald-400">Shares:</span>{" "}
                  <span className="font-mono text-white">{safeStr(liquidity.shares, '')}</span>
                </div>
              )}
              <div>
                <span className="text-emerald-400">Buy orders:</span>{" "}
                <span className="font-mono text-white">{d.wartToAssetSwaps?.length || 0}</span>
              </div>
              <div>
                <span className="text-rose-400">Sell orders:</span>{" "}
                <span className="font-mono text-white">{d.assetToWartSwaps?.length || 0}</span>
              </div>
            </div>

            {(d.wartToAssetSwaps?.length > 0 || d.assetToWartSwaps?.length > 0) && (
              <details className="mt-3 group">
                <summary className="cursor-pointer text-sm text-emerald-400 hover:text-emerald-300 flex items-center gap-2 px-1 select-none">
                  <span className="group-open:rotate-90 inline-block transition">▶</span> 
                  View open orders ({(d.wartToAssetSwaps?.length || 0) + (d.assetToWartSwaps?.length || 0)})
                </summary>
                <div className="mt-2 space-y-2 text-xs">
                  {d.wartToAssetSwaps?.length > 0 && (
                    <div>
                      <div className="text-emerald-400 mb-1 px-1">Buy (WART → {asset.name})</div>
                      {d.wartToAssetSwaps.slice(0, 2).map((order, idx) => (
                        <div key={idx} className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 flex items-center justify-between font-mono">
                          <span className="text-white">Limit {safeStr(order.limit?.doubleAdjusted || order.limit, '—')} • {order.amount?.str || '0'} (filled {order.filled?.str || '0'})</span>
                          <span onClick={() => copyToClipboard(order.txHash)} className="text-purple-400 hover:text-purple-300 cursor-pointer text-[10px]">
                            {order.txHash?.slice(0,8)}…{order.txHash?.slice(-6)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {d.assetToWartSwaps?.length > 0 && (
                    <div>
                      <div className="text-rose-400 mb-1 px-1">Sell ({asset.name} → WART)</div>
                      {d.assetToWartSwaps.slice(0, 2).map((order, idx) => (
                        <div key={idx} className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 flex items-center justify-between font-mono">
                          <span className="text-white">Limit {safeStr(order.limit?.doubleAdjusted || order.limit, '—')} • {order.amount?.str || '0'} (filled {order.filled?.str || '0'})</span>
                          <span onClick={() => copyToClipboard(order.txHash)} className="text-purple-400 hover:text-purple-300 cursor-pointer text-[10px]">
                            {order.txHash?.slice(0,8)}…{order.txHash?.slice(-6)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            )}

            <details className="mt-6 group">
              <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-400 flex items-center gap-1.5 select-none">
                <span className="group-open:rotate-90 inline-block transition">▶</span> 
                Show full JSON response
              </summary>
              <pre className="mt-3 text-[10px] bg-black/60 p-4 rounded-xl overflow-auto max-h-80 text-zinc-400 border border-zinc-800">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      );
    } catch (renderErr) {
      console.warn('renderPoolMarketCard failed to render safely:', renderErr);
      return (
        <div className="mt-4 p-4 bg-red-950/40 border border-red-700 rounded-2xl text-sm">
          <div className="text-red-400 font-medium mb-2">Could not render pool data (unexpected response shape)</div>
          <pre className="text-[10px] bg-black/60 p-3 rounded-xl overflow-auto max-h-80 text-red-300/80 border border-red-900">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      );
    }
  };

  // ==================== LP SHARES BALANCE CARD ====================
  const renderLiquiditySharesCard = (result) => {
    try {
      if (!result || result.code !== 0 || !result.data) {
        return null;
      }

      const balData = result.data || {};
      const assetInfo = balData.token || balData.asset || {};
      const balanceInfo = balData.balance?.total || balData.balance || balData;
      const assetName = assetInfo.name || 'Pool';

      return (
        <div className="mt-6 bg-amber-950/25 border border-amber-700 rounded-3xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between mb-4 gap-1 sm:gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-amber-400 text-xs tracking-[2px] font-medium">YOUR LP SHARES</div>
              <div className="text-4xl sm:text-5xl font-semibold tabular-nums tracking-[-1.5px] text-white font-mono mt-1 break-all sm:break-normal">
                {formatBalance(balanceInfo)}
              </div>
            </div>
            <div className="text-left sm:text-right mt-0.5 sm:mt-0 flex-shrink-0">
              <div className="text-xs text-amber-400/70">Redeemable in</div>
              <div className="font-semibold text-lg text-white">{assetName} pool</div>
            </div>
          </div>
          <div className="text-[10px] text-amber-500/70 border-t border-amber-800 pt-3">
            LP shares represent your pool ownership. Withdraw below to receive underlying asset + WART.
          </div>
        </div>
      );
    } catch (renderErr) {
      console.warn('renderLiquiditySharesCard failed:', renderErr);
      return null;
    }
  };

  // ==================== MY LIQUIDITY POSITION CARD ====================
  const renderPositionCard = (result) => {
    try {
      if (!result || result.code !== 0 || !result.data) {
        return (
          <div className="mt-4 p-4 bg-zinc-950 border border-zinc-700 rounded-2xl text-sm text-zinc-400">
            No position data. Deposit liquidity first, then refresh.
          </div>
        );
      }

      const balData = result.data || {};
      const assetInfo = balData.asset || balData.token || {};

      let balanceInfo = balData.balance?.total || balData.balance || balData;
      if (balanceInfo && typeof balanceInfo === 'object' && (balanceInfo.total || balanceInfo.locked || balanceInfo.mempool)) {
        balanceInfo = balanceInfo.total || {};
      }

      const assetName = assetInfo.name || balData.asset?.name || 'Asset';

      return (
        <div className="mt-6 bg-emerald-950/30 border border-emerald-700 rounded-3xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between mb-4 gap-1 sm:gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-emerald-400 text-xs tracking-[2px] font-medium">YOUR LIQUIDITY POSITION</div>
              <div className="text-4xl sm:text-5xl font-semibold tabular-nums tracking-[-1.5px] text-white font-mono mt-1 break-all sm:break-normal">
                {formatBalance(balanceInfo)}
              </div>
            </div>
            <div className="text-left sm:text-right mt-0.5 sm:mt-0 flex-shrink-0">
              <div className="text-xs text-emerald-400/70">Current holding in</div>
              <div className="font-semibold text-lg text-white">{assetName}</div>
            </div>
          </div>
          
          <div className="text-[10px] text-emerald-500/70 border-t border-emerald-800 pt-3">
            This reflects your share of the pool after confirmed deposits. Larger positions = higher fee share.
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-emerald-400/60 hover:text-emerald-400">View raw balance JSON</summary>
            <pre className="mt-2 text-[10px] bg-black/40 p-3 rounded-xl text-emerald-300/80 overflow-auto">{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      );
    } catch (renderErr) {
      console.warn('renderPositionCard failed to render safely:', renderErr);
      return (
        <div className="mt-4 p-4 bg-red-950/40 border border-red-700 rounded-2xl text-sm">
          <div className="text-red-400 font-medium mb-2">Could not render your position (unexpected balance shape from node)</div>
          <pre className="text-[10px] bg-black/60 p-3 rounded-xl overflow-auto max-h-80 text-red-300/80 border border-red-900">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      );
    }
  };

  // ==================== OPEN ORDERS RENDERER ====================
  const renderOpenOrdersCompact = (result, queriedAssetHash = null) => {
    if (!result || result.code !== 0) {
      return (
        <div className="mt-4 p-8 bg-zinc-950 border border-zinc-700 rounded-2xl text-center">
          <div className="text-4xl mb-2 opacity-40">⚠️</div>
          <p className="text-zinc-300 font-medium">Failed to load orders</p>
          <p className="text-xs text-zinc-500 mt-1">Node returned an error.</p>
        </div>
      );
    }

    let assetGroups = [];
    let isFlat = false;

    const rawData = result.data;

    if (Array.isArray(rawData) && rawData.length > 0) {
      const first = rawData[0];
      if (first && (first.baseAsset || first.wartToAssetSwaps || first.assetToWartSwaps)) {
        assetGroups = rawData;
      } else {
        isFlat = true;
        assetGroups = [{
          baseAsset: { name: 'Asset', hash: queriedAssetHash || 'unknown', id: '?' },
          wartToAssetSwaps: rawData.filter(o => o.isBuy !== false),
          assetToWartSwaps: rawData.filter(o => o.isBuy === false),
        }];
      }
    } 
    else if (rawData && typeof rawData === 'object' && (rawData.baseAsset || rawData.wartToAssetSwaps)) {
      assetGroups = [rawData];
    }

    if (assetGroups.length === 0) {
      return (
        <div className="mt-4 p-8 bg-zinc-950 border border-zinc-700 rounded-2xl text-center">
          <div className="text-4xl mb-2 opacity-40">📭</div>
          <p className="text-zinc-300 font-medium">No open limit orders</p>
          <p className="text-xs text-zinc-500 mt-1">
            {queriedAssetHash 
              ? `No pending orders found for this asset.` 
              : 'Your pending buy/sell orders will appear here.'}
          </p>
          {queriedAssetHash && (
            <p className="text-[10px] text-zinc-600 mt-2 font-mono break-all px-4">
              {queriedAssetHash}
            </p>
          )}
        </div>
      );
    }

    return (
      <div className="mt-4 space-y-4">
        {assetGroups.map((assetOrder, idx) => {
          const asset = assetOrder.baseAsset || {};
          const buyOrders = assetOrder.wartToAssetSwaps || [];
          const sellOrders = assetOrder.assetToWartSwaps || [];

          return (
            <div key={idx} className="bg-zinc-950 border border-zinc-700 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 bg-zinc-900 flex items-center justify-between border-b border-zinc-700">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 via-violet-500 to-fuchsia-500 flex items-center justify-center text-white font-bold text-xl">
                    {asset.name?.[0] || (isFlat ? '•' : '?')}
                  </div>
                  <div>
                    <div className="font-bold text-xl text-white tracking-tight">{asset.name || 'Asset'}</div>
                    <div className="text-[10px] text-zinc-500 font-mono -mt-0.5">Asset #{asset.id}</div>
                  </div>
                </div>
                {asset.hash && (
                  <div onClick={() => copyToClipboard(asset.hash)} className="text-right cursor-pointer group">
                    <div className="font-mono text-xs text-purple-400 group-hover:text-purple-300">{asset.hash?.slice(0,8)}…{asset.hash?.slice(-6)}</div>
                    <div className="text-[10px] text-zinc-500 group-hover:text-zinc-400">copy hash</div>
                  </div>
                )}
              </div>

              <div className="p-4 space-y-4">
                {buyOrders.length > 0 && (
                  <div>
                    <div className="uppercase text-emerald-400 text-xs tracking-widest mb-2 px-1 flex items-center gap-2">
                      <span className="inline-block w-2 h-2 bg-emerald-400 rounded-full"></span> 
                      BUY ORDERS ({buyOrders.length})
                    </div>
                    <div className="space-y-2">
                      {buyOrders.slice(0, 5).map((order, oIdx) => (
                        <div key={oIdx} className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-sm">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-emerald-400">Limit: {safeStr(order.limit?.doubleAdjusted || order.limit, '—')}</span>
                            <span className="text-zinc-400">Filled: {order.filled?.str || '0'} / {order.amount?.str || '0'}</span>
                          </div>
                          <div onClick={() => copyToClipboard(order.txHash)} className="font-mono text-purple-400 text-xs cursor-pointer hover:underline">
                            {order.txHash?.slice(0,10)}…{order.txHash?.slice(-6)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {sellOrders.length > 0 && (
                  <div>
                    <div className="uppercase text-rose-400 text-xs tracking-widest mb-2 px-1 flex items-center gap-2">
                      <span className="inline-block w-2 h-2 bg-rose-400 rounded-full"></span> 
                      SELL ORDERS ({sellOrders.length})
                    </div>
                    <div className="space-y-2">
                      {sellOrders.slice(0, 5).map((order, oIdx) => (
                        <div key={oIdx} className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-sm">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-rose-400">Limit: {safeStr(order.limit?.doubleAdjusted || order.limit, '—')}</span>
                            <span className="text-zinc-400">Filled: {order.filled?.str || '0'} / {order.amount?.str || '0'}</span>
                          </div>
                          <div onClick={() => copyToClipboard(order.txHash)} className="font-mono text-purple-400 text-xs cursor-pointer hover:underline">
                            {order.txHash?.slice(0,10)}…{order.txHash?.slice(-6)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {buyOrders.length === 0 && sellOrders.length === 0 && (
                  <div className="text-xs text-zinc-500 italic px-1">No orders in this group</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ==================== HANDLERS ====================
  const handleLiquidityDeposit = async () => {
    const assetHashRaw = document.getElementById('liquidityAssetHash')?.value.trim() || '';
    const assetAmountStr = document.getElementById('liquidityAssetAmount')?.value.trim() || '';
    const decimalsStr = document.getElementById('liquidityDecimals')?.value || '8';
    const wartAmountStr = document.getElementById('liquidityWartAmount')?.value.trim() || '';

    const nonceOverrideRaw = document.getElementById('liquidityNonceOverride')?.value.trim() || '';
    let nonceId = getSmartNonce();
    if (nonceOverrideRaw !== '') {
      const parsed = parseInt(nonceOverrideRaw);
      if (!isNaN(parsed)) {
        nonceId = parsed;
      }
    }

    if (!assetHashRaw || !assetAmountStr || !wartAmountStr) {
      toast.error('Asset Hash, Asset Amount, and WART Amount are required');
      return;
    }
    if (!isSigningUnlocked) {
      toast.error(isSessionLocked ? 'Unlock your wallet to deposit liquidity' : 'Wallet not loaded. Please log in again.');
      return;
    }

    setLoading(prev => ({ ...prev, liquidityDeposit: true }));
    setResults(prev => ({ ...prev, liquidityDeposit: null }));

    try {
      const api = await createWarthogApi(selectedNode);
      const { nonce, data } = await signAndSubmitTransaction(api, {
        nonceId,
        buildSpec: {
          type: 'LIQUIDITY_DEPOSIT',
          assetHash: assetHashRaw,
          assetAmount: assetAmountStr,
          decimals: decimalsStr,
          wartAmount: wartAmountStr,
        },
      });

      setResults(prev => ({ ...prev, liquidityDeposit: formatSubmitResult(data) }));
      updateNonceAfterSuccess(nonce);

      if (document.getElementById('liquidityNonceOverride')) {
        document.getElementById('liquidityNonceOverride').value = '';
      }

      toast.success('Liquidity deposit sent — check pool info below');
    } catch (err) {
      console.error(err);
      setResults(prev => ({ ...prev, liquidityDeposit: formatSubmitError(err.message || 'Unknown error') }));
      toast.error('Liquidity deposit failed: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(prev => ({ ...prev, liquidityDeposit: false }));
    }
  };

  const handleLiquidityWithdraw = async () => {
    const assetHashRaw =
      document.getElementById('liquidityWithdrawAssetHash')?.value.trim() ||
      document.getElementById('poolAssetHash')?.value.trim() ||
      '';
    const sharesStr = document.getElementById('liquidityWithdrawShares')?.value.trim() || '';
    const nonceOverrideRaw = document.getElementById('liquidityWithdrawNonceOverride')?.value.trim() || '';

    let nonceId = getSmartNonce();
    if (nonceOverrideRaw !== '') {
      const parsed = parseInt(nonceOverrideRaw, 10);
      if (!Number.isNaN(parsed)) nonceId = parsed;
    }

    if (!assetHashRaw || !sharesStr) {
      toast.error('Asset Hash and LP shares amount are required');
      return;
    }
    if (!isSigningUnlocked) {
      toast.error(isSessionLocked ? 'Unlock your wallet to withdraw liquidity' : 'Wallet not loaded. Please log in again.');
      return;
    }

    setLoading(prev => ({ ...prev, liquidityWithdraw: true }));
    setResults(prev => ({ ...prev, liquidityWithdraw: null }));

    try {
      const api = await createWarthogApi(selectedNode);
      const { nonce, data } = await signAndSubmitTransaction(api, {
        nonceId,
        buildSpec: {
          type: 'LIQUIDITY_WITHDRAW',
          assetHash: assetHashRaw,
          shares: sharesStr,
        },
      });

      setResults(prev => ({ ...prev, liquidityWithdraw: formatSubmitResult(data) }));
      updateNonceAfterSuccess(nonce);

      if (document.getElementById('liquidityWithdrawNonceOverride')) {
        document.getElementById('liquidityWithdrawNonceOverride').value = '';
      }

      toast.success('Liquidity withdrawal sent — check History for received asset + WART');
    } catch (err) {
      console.error(err);
      setResults(prev => ({ ...prev, liquidityWithdraw: formatSubmitError(err.message || 'Unknown error') }));
      toast.error('Liquidity withdrawal failed: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(prev => ({ ...prev, liquidityWithdraw: false }));
    }
  };

  const fillWithdrawSharesFromBalance = () => {
    const balanceResult = results.myLiquidityBalance;
    if (!balanceResult || balanceResult.code !== 0) {
      toast.error('Load pool & position first to fetch your LP share balance');
      return;
    }

    const balData = balanceResult.data || {};
    const balanceInfo = balData.balance?.total || balData.balance || balData;
    const shares = safeStr(balanceInfo, '');
    if (!shares || shares === '0') {
      toast.error('No LP shares found for this pool');
      return;
    }

    const poolHash = document.getElementById('poolAssetHash')?.value.trim() || '';
    const assetInput = document.getElementById('liquidityWithdrawAssetHash');
    const sharesInput = document.getElementById('liquidityWithdrawShares');
    if (assetInput && poolHash) assetInput.value = poolHash;
    if (sharesInput) sharesInput.value = shares;
    toast.success('Filled withdraw form with your LP share balance');
  };

  const loadPoolAndPosition = async () => {
    const assetRaw = document.getElementById('poolAssetHash')?.value.trim() || '';
    if (!assetRaw) {
      toast.error('Please enter an Asset Hash');
      return;
    }

    let assetHash = assetRaw;
    if (assetHash.toLowerCase().startsWith('0x')) assetHash = assetHash.slice(2);
    if (assetHash.length !== 64) {
      toast.error('Asset Hash must be exactly 64 hex characters');
      return;
    }

    await query('poolMarket', `dex/market/${encodeURIComponent(assetHash)}`);

    if (account) {
      await query('myAssetBalance', `account/${account}/balance/asset:${assetHash}`);
      await query('myLiquidityBalance', `account/${account}/balance/liquidity:${assetHash}`);
    }
  };

  const handleLimitSwap = async () => {
    const assetHashRaw = document.getElementById('limitAssetHash')?.value.trim() || '';
    const isBuy = document.getElementById('limitIsBuy')?.checked ?? true;
    const amountStr = document.getElementById('limitAmount')?.value.trim() || '';
    const limitHex = document.getElementById('limitEncoded')?.value.trim() || '';
    const assetDecimalsStr = document.getElementById('limitPriceDecimals')?.value || '8';

    const nonceOverrideRaw = document.getElementById('limitNonceOverride')?.value.trim() || '';
    let nonceId = getSmartNonce();
    if (nonceOverrideRaw !== '') {
      const parsed = parseInt(nonceOverrideRaw);
      if (!isNaN(parsed)) {
        nonceId = parsed;
      }
    }

    if (!assetHashRaw || !amountStr || !limitHex) {
      toast.error('Asset Hash, Amount, and Encoded Limit Price are required');
      return;
    }
    if (!isSigningUnlocked) {
      toast.error(isSessionLocked ? 'Unlock your wallet to place limit orders' : 'Wallet not loaded. Please log in again.');
      return;
    }

    setLoading(prev => ({ ...prev, limitSwap: true }));
    setResults(prev => ({ ...prev, limitSwap: null }));

    try {
      const api = await createWarthogApi(selectedNode);
      const { nonce, data } = await signAndSubmitTransaction(api, {
        nonceId,
        buildSpec: {
          type: 'LIMIT_SWAP',
          assetHash: assetHashRaw,
          isBuy,
          amount: amountStr,
          assetDecimals: assetDecimalsStr,
          limitHex,
        },
      });

      setResults(prev => ({ ...prev, limitSwap: formatSubmitResult(data) }));
      updateNonceAfterSuccess(nonce);

      if (document.getElementById('limitNonceOverride')) {
        document.getElementById('limitNonceOverride').value = '';
      }

      toast.success('Limit order submitted — balance may stay locked until the order fills');
    } catch (err) {
      console.error(err);
      setResults(prev => ({ ...prev, limitSwap: formatSubmitError(err.message || 'Unknown error') }));
      toast.error('Limit order failed: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(prev => ({ ...prev, limitSwap: false }));
    }
  };

  const encodeLimitPrice = async () => {
    const priceStr = document.getElementById('limitPriceHuman')?.value.trim();
    const decimalsStr = document.getElementById('limitPriceDecimals')?.value.trim() || '8';

    if (!priceStr) {
      toast.error('Please enter a price');
      return;
    }

    try {
      const { encodeLimitPriceHex } = await import('../utils/encodeLimitPrice.js');
      let encoded;
      try {
        encoded = await encodeLimitPriceHex(priceStr, decimalsStr, { ceil: false });
      } catch {
        encoded = await encodeLimitPriceHex(priceStr, decimalsStr, { ceil: true });
      }

      document.getElementById('limitEncoded').value = encoded;
      toast.success(`Encoded limit: ${encoded}`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to encode price: ' + (err.message || 'Unknown error'));
    }
  };

  const tabs = [
    { id: 'market', label: 'Market Data' },
    { id: 'trading', label: 'Trading Activity' },
    { id: 'deposit', label: 'Liquidity' },
    { id: 'position', label: 'Pool & Position' },
    { id: 'limit', label: 'Limit Orders' },
  ];

  return (
    <>
      <div className="dex-tabs flex w-full gap-1 p-1 mb-6 bg-zinc-950 border border-zinc-800 rounded-xl overflow-x-auto scrollbar-hide">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`dex-tab-btn whitespace-nowrap${isActive ? ' dex-tab-btn--active' : ''}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ==================== TAB CONTENTS ==================== */}

      {activeTab === 'market' && (
        <section className="border-2 border-green-500 rounded-3xl p-8 bg-green-50 dark:bg-green-950 shadow-xl">
          <h2 className="text-2xl font-bold mb-6">DEX Tools</h2>
          <p className="mb-6 text-gray-600 dark:text-gray-400">
            Query decentralized exchange markets and trading data.
          </p>

          <h3 className="text-xl font-semibold mb-4 text-green-700 dark:text-green-300">
            Market Data
          </h3>
          <div>
              <label className="block text-sm font-medium mb-2">Market Identifier</label>
              <input id="market" placeholder="market identifier or asset hash" className="input mb-4" />
              <button
                onClick={() => query('dexMarket', `dex/market/${encodeURIComponent(document.getElementById('market').value)}`)}
                disabled={loading.dexMarket}
                className="px-6 py-3 mx-2 my-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded-2xl transition-colors"
              >
                {loading.dexMarket ? 'Querying...' : 'Query Market'}
              </button>
              
              {results.dexMarket && renderPoolMarketCard(results.dexMarket)}
          </div>
        </section>
      )}

      {activeTab === 'trading' && (
        <section className="border-2 border-orange-500 rounded-3xl p-8 bg-orange-50 dark:bg-orange-950 shadow-xl">
          <h3 className="text-xl font-semibold mb-6 text-orange-700 dark:text-orange-300">
            Trading Activity
          </h3>
          <p className="text-sm text-orange-600 dark:text-orange-400 mb-6">
            Uses your connected wallet address
          </p>

          <div className="space-y-8">
            <div>
              <button
                onClick={() => query('openOrders', `account/${account}/open_orders`)}
                disabled={loading.openOrders || !account}
                className="px-6 py-3 mx-2 my-1 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-2xl transition-colors disabled:bg-gray-400"
              >
                {loading.openOrders ? 'Loading...' : 'View All Open Orders'}
              </button>
              {results.openOrders && renderOpenOrdersCompact(results.openOrders)}
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Open Orders for Specific Asset</label>
              <input id="assetForOrders" placeholder="asset identifier" className="input mb-3" />
              <button
                onClick={() => query('openOrdersAsset', `account/${account}/open_orders/${encodeURIComponent(document.getElementById('assetForOrders').value)}`)}
                disabled={!account}
                className="px-6 py-3 mx-2 my-1 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-2xl transition-colors disabled:bg-gray-400"
              >
                Query Asset Orders
              </button>
              {results.openOrdersAsset && renderOpenOrdersCompact(
                results.openOrdersAsset, 
                document.getElementById('assetForOrders')?.value.trim()
              )}

              {results.openOrdersAsset && (
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-orange-400 hover:text-orange-300">Show raw node response (for debugging)</summary>
                  <pre className="mt-2 p-3 bg-black/60 rounded-xl text-[10px] text-orange-300 overflow-auto max-h-64 border border-orange-900">
                    {JSON.stringify(results.openOrdersAsset, null, 2)}
                  </pre>
                </details>
              )}
            </div>

            <div>
              <button
                onClick={() => query('mempool', `account/${account}/mempool`)}
                disabled={loading.mempool || !account}
                className="px-6 py-3 mx-2 my-1 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-2xl transition-colors disabled:bg-gray-400"
              >
                {loading.mempool ? 'Loading...' : 'View Mempool'}
              </button>
              {results.mempool && (
                <pre className="result mt-4 text-xs">{JSON.stringify(results.mempool, null, 2)}</pre>
              )}
            </div>
          </div>
        </section>
      )}

      {activeTab === 'deposit' && (
        <div>
          <div className="flex items-center gap-2 mb-6">
            <button
              type="button"
              onClick={() => setLiquidityMode('deposit')}
              className={`compact-btn hover:!text-[#FDB913] !mx-0 !my-0 !px-3 !py-1${
                liquidityMode === 'deposit' ? ' compact-btn--active' : ''
              }`}
            >
              Deposit
            </button>
            <button
              type="button"
              onClick={() => setLiquidityMode('withdraw')}
              className={`compact-btn hover:!text-[#FDB913] !mx-0 !my-0 !px-3 !py-1${
                liquidityMode === 'withdraw' ? ' compact-btn--active' : ''
              }`}
            >
              Withdraw
            </button>
          </div>

          {liquidityMode === 'deposit' ? (
            <section className="border-2 border-cyan-500 rounded-3xl p-8 bg-cyan-50 dark:bg-cyan-950 shadow-xl">
              <h3 className="text-xl font-semibold mb-6 text-cyan-700 dark:text-cyan-300">
                Liquidity Deposit (Asset → WART Pool)
              </h3>
              <p className="text-sm text-cyan-600 dark:text-cyan-400 mb-6">
                Deposit asset tokens + WART into the asset&apos;s liquidity pool. You receive LP shares representing your pool ownership.
              </p>

              <div>
                <label className="block text-sm font-medium mb-2">Asset Hash (64 hex chars, no 0x)</label>
                <input id="liquidityAssetHash" placeholder="e.g. 0e4825efffa294610d2ac376713e3bcc9b53d378e823834b64e5df01f75d3b0c" className="input mb-3 font-mono text-sm" />

                <label className="block text-sm font-medium mb-2">Asset Amount (in token units)</label>
                <input id="liquidityAssetAmount" type="number" step="any" placeholder="e.g. 1000" className="input mb-3" />

                <label className="block text-sm font-medium mb-2">Asset Decimals / Precision</label>
                <input id="liquidityDecimals" type="number" defaultValue="8" className="input mb-3" />

                <label className="block text-sm font-medium mb-2">WART Amount to Deposit</label>
                <input id="liquidityWartAmount" type="number" step="any" placeholder="e.g. 10.0" className="input mb-3" />

                <label className="block text-sm font-medium mb-2 text-amber-400">
                  Nonce Override (only if duplicate nonce error)
                </label>
                <input id="liquidityNonceOverride" type="number" placeholder="Leave empty for auto" className="input mb-6" />

                <button
                  onClick={handleLiquidityDeposit}
                  disabled={loading.liquidityDeposit}
                  className="w-full py-4 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-2xl transition-all disabled:bg-gray-400"
                >
                  {loading.liquidityDeposit ? 'Depositing Liquidity...' : 'Deposit Liquidity'}
                </button>

                {results.liquidityDeposit && renderTransactionResult(results.liquidityDeposit, 'Liquidity Deposit')}
              </div>
            </section>
          ) : (
            <section className="border-2 border-amber-500 rounded-3xl p-8 bg-amber-50 dark:bg-amber-950 shadow-xl">
              <h3 className="text-xl font-semibold mb-6 text-amber-700 dark:text-amber-300">
                Liquidity Withdrawal (LP Shares → Asset + WART)
              </h3>
              <p className="text-sm text-amber-600 dark:text-amber-400 mb-6">
                Redeem LP shares from a pool to receive your proportional asset tokens and WART back. Use Pool &amp; Position to look up your share balance first.
              </p>

              <div>
                <label className="block text-sm font-medium mb-2">Asset Hash (64 hex chars, no 0x)</label>
                <input id="liquidityWithdrawAssetHash" placeholder="Same hash as the pool you deposited into" className="input mb-3 font-mono text-sm" />

                <label className="block text-sm font-medium mb-2">LP Shares to Redeem</label>
                <input id="liquidityWithdrawShares" type="number" step="any" placeholder="e.g. 1.5" className="input mb-3" />

                <label className="block text-sm font-medium mb-2 text-amber-400">
                  Nonce Override (only if duplicate nonce error)
                </label>
                <input id="liquidityWithdrawNonceOverride" type="number" placeholder="Leave empty for auto" className="input mb-6" />

                <button
                  onClick={handleLiquidityWithdraw}
                  disabled={loading.liquidityWithdraw}
                  className="w-full py-4 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-2xl transition-all disabled:bg-gray-400"
                >
                  {loading.liquidityWithdraw ? 'Withdrawing Liquidity...' : 'Withdraw Liquidity'}
                </button>

                {results.liquidityWithdraw && renderTransactionResult(results.liquidityWithdraw, 'Liquidity Withdrawal')}
              </div>
            </section>
          )}
        </div>
      )}

      {activeTab === 'position' && (
        <section className="border-2 border-emerald-500 rounded-3xl p-8 bg-emerald-50 dark:bg-emerald-950 shadow-xl">
          <h3 className="text-xl font-semibold mb-6 text-emerald-700 dark:text-emerald-300">
            Pool Info &amp; My Liquidity Position
          </h3>
          <p className="text-sm text-emerald-600 dark:text-emerald-400 mb-6">
            After your liquidity deposit confirms on-chain, paste the Asset Hash here to view the updated pool state and your position.
          </p>

          <div className="flex flex-col md:flex-row gap-3 mb-6">
            <input
              id="poolAssetHash"
              placeholder="Paste the same Asset Hash you deposited into"
              className="input flex-1 font-mono text-sm"
            />
            <button
              onClick={loadPoolAndPosition}
              disabled={loading.poolMarket || loading.myAssetBalance || loading.myLiquidityBalance}
              className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-2xl transition-all disabled:bg-gray-400 whitespace-nowrap"
            >
              {loading.poolMarket || loading.myAssetBalance || loading.myLiquidityBalance ? 'Loading...' : 'Load Pool & My Position'}
            </button>
          </div>

          {results.poolMarket && renderPoolMarketCard(results.poolMarket)}
          {results.myLiquidityBalance && renderLiquiditySharesCard(results.myLiquidityBalance)}
          {results.myAssetBalance && renderPositionCard(results.myAssetBalance)}

          {(results.myLiquidityBalance?.code === 0 || results.poolMarket?.code === 0) && (
            <div className="mt-8 border-2 border-amber-600/60 rounded-3xl p-6 bg-amber-950/20">
              <h4 className="text-lg font-semibold text-amber-300 mb-2">Withdraw from this pool</h4>
              <p className="text-sm text-amber-400/80 mb-4">
                Redeem LP shares to receive underlying {results.poolMarket?.data?.baseAsset?.name || 'asset'} + WART.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <input id="liquidityWithdrawShares" type="number" step="any" placeholder="LP shares to redeem" className="input flex-1" />
                <button
                  type="button"
                  onClick={fillWithdrawSharesFromBalance}
                  className="px-4 py-2 text-sm font-medium rounded-xl border border-amber-700/60 text-amber-300 hover:bg-amber-900/40 transition-colors whitespace-nowrap"
                >
                  Use my full balance
                </button>
              </div>
              <button
                onClick={handleLiquidityWithdraw}
                disabled={loading.liquidityWithdraw}
                className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-2xl transition-all disabled:bg-gray-400"
              >
                {loading.liquidityWithdraw ? 'Withdrawing...' : 'Withdraw Liquidity'}
              </button>
              {results.liquidityWithdraw && renderTransactionResult(results.liquidityWithdraw, 'Liquidity Withdrawal')}
            </div>
          )}

          {!results.poolMarket && !results.myAssetBalance && !results.myLiquidityBalance && (
            <div className="text-sm text-gray-500 italic bg-emerald-950/50 p-4 rounded-2xl">
              Enter the Asset Hash you deposited liquidity into, then click the button above.<br />
              You will see the current pool reserves + your personal balance/position.
            </div>
          )}
        </section>
      )}

      {activeTab === 'limit' && (
        <section className="border-2 border-violet-500 rounded-3xl p-8 bg-violet-50 dark:bg-violet-950 shadow-xl">
          <h3 className="text-xl font-semibold mb-6 text-violet-700 dark:text-violet-300">
            Limit Orders (Buy / Sell)
          </h3>
          <p className="text-sm text-violet-600 dark:text-violet-400 mb-6">
            Create buy or sell limit orders. Use the price encoder to generate the 6-character limit hex.
          </p>

          <div>
              <label className="block text-sm font-medium mb-2">Asset Hash (64 hex chars, no 0x)</label>
              <input id="limitAssetHash" placeholder="e.g. 0e4825efffa294610d2ac376713e3bcc9b53d378e823834b64e5df01f75d3b0c" className="input mb-3 font-mono text-sm" />

              <div className="flex items-center gap-3 mb-4">
                <input type="checkbox" id="limitIsBuy" defaultChecked className="w-4 h-4 accent-violet-600" />
                <label htmlFor="limitIsBuy" className="text-sm font-medium">This is a Buy order (uncheck for Sell)</label>
              </div>

              <label className="block text-sm font-medium mb-2">Amount</label>
              <input id="limitAmount" type="number" step="any" placeholder="Amount in WART (buy) or asset units (sell)" className="input mb-4" />

              <div className="bg-zinc-900 border border-violet-700 p-4 rounded-2xl mb-4">
                <div className="text-sm font-medium text-violet-300 mb-3">
                  Quick Limit Price Encoder
                </div>

                <div className="flex flex-col md:flex-row gap-3 items-end">
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 block mb-1.5">Price</label>
                    <input
                      id="limitPriceHuman"
                      type="text"
                      placeholder="e.g. 0.0005"
                      className="w-full bg-black border border-zinc-700 focus:border-violet-500 text-white px-4 py-3 rounded-xl outline-none"
                    />
                  </div>

                  <div className="w-full md:w-28">
                    <label className="text-xs text-gray-400 block mb-1.5">Decimals</label>
                    <input
                      id="limitPriceDecimals"
                      type="number"
                      defaultValue="8"
                      className="w-full bg-black border border-zinc-700 focus:border-violet-500 text-white px-4 py-3 rounded-xl outline-none"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={encodeLimitPrice}
                    className="compact-btn hover:!text-[#FDB913] !mx-0 !my-0 !px-3 !py-1 self-end whitespace-nowrap"
                  >
                    Encode
                  </button>
                </div>

                <p className="text-xs text-gray-500 mt-2">
                  Enter human price + decimals → click Encode
                </p>
              </div>

              <label className="block text-sm font-medium mb-2">Encoded Limit (exactly 6 hex characters)</label>
              <input id="limitEncoded" placeholder="e.g. c0e74d" maxLength={6} className="input mb-3 font-mono" />

              <label className="block text-sm font-medium mb-2 text-amber-400">
                Nonce Override (only if duplicate nonce error)
              </label>
              <input id="limitNonceOverride" type="number" placeholder="Leave empty for auto" className="input mb-6" />

              <button
                onClick={handleLimitSwap}
                disabled={loading.limitSwap}
                className="w-full py-4 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-2xl transition-all disabled:bg-gray-400"
              >
                {loading.limitSwap ? 'Submitting Limit Order...' : 'Submit Limit Order'}
              </button>

              {results.limitSwap && renderTransactionResult(results.limitSwap, 'Limit Order')}
          </div>
        </section>
      )}

    </>
  );
};

export default DexPage;