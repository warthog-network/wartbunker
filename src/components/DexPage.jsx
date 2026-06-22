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
  CHART_API_UNSUPPORTED_CODE,
  CHART_INTERVALS,
  buildCandlesPath,
  buildPriceHistoryFromLatest,
  buildTradesPath,
  computePoolSpotPrice,
  formatAssetPrice,
  normalizeChartAssetHash,
  parseCandleResponse,
  parseTradeResponse,
} from '../utils/dexPrice.js';
import AssetPriceChart from './AssetPriceChart.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import { DEFAULT_NODE_URL } from '../utils/presetNodes.js';
import {
  buildVolumePlan,
  clampRounds,
  estimateWartRequired,
  executeVolumePlan,
  fetchVolumeContext,
  summarizeVolumePlan,
} from '../utils/dexVolume.js';

const DexPage = ({ selectedNode: propSelectedNode, wallet: propWallet }) => {
  const {
    nextNonce: contextNextNonce,
    selectedNode: contextSelectedNode,
  } = useWallet();

  const selectedNode = propSelectedNode || contextSelectedNode || DEFAULT_NODE_URL;

  const wallet = propWallet || (() => {
    try {
      if (typeof sessionStorage === 'undefined') return null;
      const saved = sessionStorage.getItem('warthogWalletDecrypted');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  })();

  const toast = useToast();

  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});
  const [activeTab, setActiveTab] = useState('market');
  const [chartMode, setChartMode] = useState('candles');
  const [chartInterval, setChartInterval] = useState('1h');
  const [chartAssetName, setChartAssetName] = useState('Asset');
  const [chartFallbackNote, setChartFallbackNote] = useState(null);

  const [volumePlan, setVolumePlan] = useState([]);
  const [volumeContext, setVolumeContext] = useState(null);
  const [volumeLogs, setVolumeLogs] = useState([]);
  const [volumeStrategy, setVolumeStrategy] = useState('buys');
  const [volumeConfirmOpen, setVolumeConfirmOpen] = useState(false);
  const [volumeConfirmMessage, setVolumeConfirmMessage] = useState('');
  const [volumePendingRun, setVolumePendingRun] = useState(null);

  useEffect(() => {
    if (activeTab === 'limit' || activeTab === 'volume') {
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
    if (!wallet?.privateKey) {
      toast.error('Wallet not loaded. Please log in again.');
      return;
    }

    setLoading(prev => ({ ...prev, liquidityDeposit: true }));
    setResults(prev => ({ ...prev, liquidityDeposit: null }));

    try {
      const api = await createWarthogApi(selectedNode);
      const { buildLiquidityDepositTx } = await import('../utils/buildDexTx.js');
      const { nonce, data } = await signAndSubmitTransaction(api, {
        privateKey: wallet.privateKey,
        nonceId,
        buildTx: (ctx, account) => buildLiquidityDepositTx(ctx, account, {
          assetHash: assetHashRaw,
          assetAmount: assetAmountStr,
          decimals: decimalsStr,
          wartAmount: wartAmountStr,
        }),
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

  const loadPriceChart = async () => {
    const assetRaw = document.getElementById('chartAssetHash')?.value.trim() || '';
    const assetHash = normalizeChartAssetHash(assetRaw);
    if (!assetHash) {
      toast.error('Asset Hash must be exactly 64 hex characters');
      return;
    }

    const countRaw = document.getElementById('chartCount')?.value.trim() || '200';
    const n = Math.min(500, Math.max(10, parseInt(countRaw, 10) || 200));

    const chartKey = chartMode === 'candles' ? 'priceCandles' : 'priceTrades';
    setLoading(prev => ({ ...prev, [chartKey]: true }));
    setChartFallbackNote(null);

    try {
      const path = chartMode === 'candles'
        ? buildCandlesPath(assetHash, chartInterval, { n })
        : buildTradesPath(assetHash, { n });

      const api = await createWarthogApi(selectedNode);
      const result = await getNodeData(api, path);

      let points = [];
      let usedFallback = false;

      if (result.code === 0) {
        points = chartMode === 'candles'
          ? parseCandleResponse(result.data)
          : parseTradeResponse(result.data);
      } else if (result.code === CHART_API_UNSUPPORTED_CODE) {
        const latestRes = await getNodeData(api, 'transaction/latest');
        if (latestRes.code !== 0) {
          setResults(prev => ({
            ...prev,
            [chartKey]: {
              error: 'Chart API is not enabled on this node and recent trades could not be loaded.',
            },
          }));
          return;
        }

        points = buildPriceHistoryFromLatest(latestRes.data, assetHash, {
          mode: chartMode,
          interval: chartInterval,
          n,
        });
        usedFallback = true;

        if (!points.length) {
          setResults(prev => ({
            ...prev,
            [chartKey]: {
              error: 'Chart API is not enabled on this node yet. No recent DEX matches were found for this asset in the latest blocks.',
            },
          }));
          return;
        }
      } else {
        setResults(prev => ({
          ...prev,
          [chartKey]: { error: result.error || 'Node returned an error' },
        }));
        return;
      }

      setResults(prev => ({ ...prev, [chartKey]: { code: 0, data: points } }));
      if (usedFallback) {
        setChartFallbackNote(
          'Chart API unavailable on this node — showing DEX match trades from recent blocks (/transaction/latest).',
        );
      }

      const marketRes = await getNodeData(api, `dex/market/${assetHash}`);
      if (marketRes.code === 0) {
        const name = marketRes.data?.baseAsset?.name;
        if (name) setChartAssetName(name);
      }
    } catch (err) {
      setResults(prev => ({
        ...prev,
        [chartKey]: { error: err.message || 'Failed to load chart data' },
      }));
    } finally {
      setLoading(prev => ({ ...prev, [chartKey]: false }));
    }
  };

  const renderPriceChartSection = () => {
    const chartKey = chartMode === 'candles' ? 'priceCandles' : 'priceTrades';
    const chartResult = results[chartKey];
    const chartLoading = loading[chartKey];
    const chartError = chartResult?.error
      || (chartResult && chartResult.code !== 0 ? chartResult.error : null);
    const chartPoints = chartResult?.code === 0 ? chartResult.data : [];
    const intervalLabel = CHART_INTERVALS.find((i) => i.id === chartInterval)?.label || chartInterval;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Asset Hash (64 hex chars)</label>
            <input
              id="chartAssetHash"
              placeholder="e.g. 0e4825efffa294610d2ac376713e3bcc9b53d378e823834b64e5df01f75d3b0c"
              className="input font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Data points (n)</label>
            <input id="chartCount" type="number" min="10" max="500" defaultValue="200" className="input" />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Chart type</label>
            <div className="flex gap-1 p-1 bg-zinc-900 border border-zinc-700 rounded-xl">
              <button
                type="button"
                onClick={() => setChartMode('candles')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${chartMode === 'candles' ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white'}`}
              >
                Candles
              </button>
              <button
                type="button"
                onClick={() => setChartMode('trades')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${chartMode === 'trades' ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white'}`}
              >
                Trades
              </button>
            </div>
          </div>

          {chartMode === 'candles' && (
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Interval</label>
              <select
                value={chartInterval}
                onChange={(e) => setChartInterval(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 text-white px-4 py-2.5 rounded-xl outline-none focus:border-violet-500"
              >
                {CHART_INTERVALS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={loadPriceChart}
            disabled={chartLoading}
            className="px-8 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-2xl transition-all disabled:bg-gray-400"
          >
            {chartLoading ? 'Loading…' : 'Load Price Chart'}
          </button>
        </div>

        {chartFallbackNote && (
          <div className="p-3 bg-amber-950/40 border border-amber-700/60 rounded-xl text-xs text-amber-200">
            {chartFallbackNote}
          </div>
        )}

        <AssetPriceChart
          points={chartPoints}
          mode={chartMode}
          assetName={chartAssetName}
          intervalLabel={chartMode === 'candles' ? intervalLabel : 'Recent trades'}
          loading={chartLoading}
          error={chartError}
        />

        {chartMode === 'trades' && chartPoints?.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-sm text-violet-400 hover:text-violet-300 flex items-center gap-2 select-none">
              <span className="group-open:rotate-90 inline-block transition">▶</span>
              Recent trades table ({Math.min(chartPoints.length, 20)} shown)
            </summary>
            <div className="mt-2 overflow-x-auto rounded-xl border border-zinc-700">
              <table className="w-full text-xs font-mono">
                <thead className="bg-zinc-900 text-zinc-400">
                  <tr>
                    <th className="text-left px-3 py-2">Time</th>
                    <th className="text-right px-3 py-2">Block</th>
                    <th className="text-right px-3 py-2">Base</th>
                    <th className="text-right px-3 py-2">Quote (WART)</th>
                    <th className="text-right px-3 py-2">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {[...chartPoints].reverse().slice(0, 20).map((t, idx) => (
                    <tr key={idx} className="border-t border-zinc-800 text-zinc-300">
                      <td className="px-3 py-1.5">
                        {new Date(t.timestamp * 1000).toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-right">{t.height}</td>
                      <td className="px-3 py-1.5 text-right">{formatAssetPrice(t.base, 4)}</td>
                      <td className="px-3 py-1.5 text-right">{formatAssetPrice(t.quote, 4)}</td>
                      <td className="px-3 py-1.5 text-right text-emerald-400">
                        {formatAssetPrice(t.price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    );
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
    if (!wallet?.privateKey) {
      toast.error('Wallet not loaded. Please log in again.');
      return;
    }

    setLoading(prev => ({ ...prev, limitSwap: true }));
    setResults(prev => ({ ...prev, limitSwap: null }));

    try {
      const api = await createWarthogApi(selectedNode);
      const { buildLimitSwapTx } = await import('../utils/buildDexTx.js');
      const { nonce, data } = await signAndSubmitTransaction(api, {
        privateKey: wallet.privateKey,
        nonceId,
        buildTx: (ctx, account) => buildLimitSwapTx(ctx, account, {
          assetHash: assetHashRaw,
          isBuy,
          amount: amountStr,
          assetDecimals: assetDecimalsStr,
          limitHex,
        }),
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

  const readVolumeForm = () => {
    const assetRaw = document.getElementById('volumeAssetHash')?.value.trim() || '';
    const assetHash = normalizeChartAssetHash(assetRaw);
    return {
      assetHash,
      rounds: clampRounds(document.getElementById('volumeRounds')?.value || 5),
      strategy: volumeStrategy,
      buyWart: document.getElementById('volumeBuyWart')?.value.trim() || '1',
      sellAsset: document.getElementById('volumeSellAsset')?.value.trim() || '10',
      basePrice: parseFloat(document.getElementById('volumeBasePrice')?.value || '0'),
      priceStep: parseFloat(document.getElementById('volumePriceStep')?.value || '0'),
      delayMs: Math.max(0, parseInt(document.getElementById('volumeDelayMs')?.value || '1500', 10) || 0),
    };
  };

  const previewVolumePlan = async () => {
    const form = readVolumeForm();
    if (!form.assetHash) {
      toast.error('Asset hash must be exactly 64 hex characters');
      return;
    }
    if (!wallet?.address) {
      toast.error('Connect a wallet first');
      return;
    }

    setLoading(prev => ({ ...prev, volumePreview: true }));
    setVolumeLogs([]);

    try {
      const api = await createWarthogApi(selectedNode);
      const ctx = await fetchVolumeContext(api, wallet.address, form.assetHash);
      setVolumeContext(ctx);

      const plan = await buildVolumePlan({
        rounds: form.rounds,
        basePrice: form.basePrice,
        priceStep: form.priceStep,
        buyWart: form.buyWart,
        sellAsset: form.sellAsset,
        strategy: form.strategy,
        decimals: ctx.decimals,
      });
      setVolumePlan(plan);
      toast.success(`Plan ready — ${plan.length} orders for ${ctx.assetName}`);
    } catch (err) {
      console.error(err);
      setVolumePlan([]);
      setVolumeContext(null);
      toast.error(err.message || 'Could not build volume plan');
    } finally {
      setLoading(prev => ({ ...prev, volumePreview: false }));
    }
  };

  const applyPoolSpotPrice = async () => {
    const form = readVolumeForm();
    if (!form.assetHash || !wallet?.address) {
      toast.error('Enter asset hash and connect wallet');
      return;
    }
    try {
      const api = await createWarthogApi(selectedNode);
      const ctx = await fetchVolumeContext(api, wallet.address, form.assetHash);
      setVolumeContext(ctx);
      if (ctx.spotPrice == null) {
        toast.error('Pool has no liquidity — deposit first or set price manually');
        return;
      }
      const el = document.getElementById('volumeBasePrice');
      if (el) el.value = String(ctx.spotPrice);
      toast.success(`Base price set to pool spot (${ctx.spotPriceLabel} WART/${ctx.assetName})`);
    } catch (err) {
      toast.error(err.message || 'Could not read pool price');
    }
  };

  const prepareVolumeRun = async () => {
    const form = readVolumeForm();
    if (!form.assetHash) {
      throw new Error('Asset hash must be exactly 64 hex characters');
    }
    if (!wallet?.address) {
      throw new Error('Connect a wallet first');
    }

    const api = await createWarthogApi(selectedNode);
    const ctx = volumeContext?.assetHash === form.assetHash
      ? volumeContext
      : await fetchVolumeContext(api, wallet.address, form.assetHash);
    setVolumeContext(ctx);

    const plan = await buildVolumePlan({
      rounds: form.rounds,
      basePrice: form.basePrice,
      priceStep: form.priceStep,
      buyWart: form.buyWart,
      sellAsset: form.sellAsset,
      strategy: form.strategy,
      decimals: ctx.decimals,
    });
    setVolumePlan(plan);

    if (ctx.balances.wart === '0' || ctx.balances.wart === '?') {
      throw new Error('Insufficient WART balance');
    }

    return { api, form, ctx, plan };
  };

  const buildVolumeConfirmMessage = (ctx, plan, form) => {
    const summary = summarizeVolumePlan(plan, {
      assetBalance: Number(ctx.balances.asset) || 0,
      assetName: ctx.assetName,
    });

    const lines = [
      `Submit ${summary.submitCount} limit order${summary.submitCount !== 1 ? 's' : ''} for ${ctx.assetName}?`,
      '',
      `• ${summary.buyCount} buy order${summary.buyCount !== 1 ? 's' : ''} (~${summary.buyTotal.toFixed(2)} WART on book)`,
    ];

    if (summary.sellCount > 0) {
      if (summary.sellsSkipped > 0) {
        lines.push(`• ${summary.sellCount} sell order${summary.sellCount !== 1 ? 's' : ''} (will be skipped — no ${ctx.assetName} balance)`);
      } else {
        lines.push(`• ${summary.sellCount} sell order${summary.sellCount !== 1 ? 's' : ''} (~${summary.assetCommitted.toFixed(2)} ${ctx.assetName} on book)`);
      }
    }

    lines.push(
      '',
      `Estimated WART committed: ~${summary.buyTotal.toFixed(2)} + ~${summary.feeTotal.toFixed(2)} tx fees`,
      `Delay between orders: ${form.delayMs} ms`,
      '',
      'Orders stay on the book until matched or cancelled. Review the plan above before confirming.',
    );

    return lines.join('\n');
  };

  const requestVolumeRun = async () => {
    if (!wallet?.privateKey) {
      toast.error('Wallet not loaded. Please log in again.');
      return;
    }

    setLoading(prev => ({ ...prev, volumeConfirm: true }));

    try {
      const prepared = await prepareVolumeRun();
      setVolumePendingRun(prepared);
      setVolumeConfirmMessage(buildVolumeConfirmMessage(prepared.ctx, prepared.plan, prepared.form));
      setVolumeConfirmOpen(true);
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not prepare volume run');
    } finally {
      setLoading(prev => ({ ...prev, volumeConfirm: false }));
    }
  };

  const cancelVolumeRun = () => {
    setVolumeConfirmOpen(false);
    setVolumePendingRun(null);
    setVolumeConfirmMessage('');
  };

  const runVolumeGenerator = async () => {
    if (loading.volumeRun) return;
    if (!wallet?.privateKey || !volumePendingRun) {
      cancelVolumeRun();
      return;
    }

    const { api, form, ctx, plan } = volumePendingRun;
    setVolumeConfirmOpen(false);
    setLoading(prev => ({ ...prev, volumeRun: true }));
    setVolumeLogs([]);

    try {
      let nonce = getSmartNonce();
      const logs = [];

      const { logs: resultLogs, nextNonce } = await executeVolumePlan({
        api,
        privateKey: wallet.privateKey,
        assetHash: ctx.assetHash,
        plan,
        decimals: ctx.decimals,
        startNonce: nonce,
        delayMs: form.delayMs,
        assetBalance: Number(ctx.balances.asset) || 0,
        onProgress: (entry) => {
          logs.push(entry);
          setVolumeLogs([...logs]);
        },
      });

      setVolumeLogs(resultLogs);
      if (resultLogs.some((l) => l.status === 'ok' && l.nonce != null)) {
        updateNonceAfterSuccess(nextNonce - 1);
      }

      const ok = resultLogs.filter((l) => l.status === 'ok').length;
      toast.success(`Volume run complete — ${ok}/${resultLogs.length} orders submitted`);
    } catch (err) {
      console.error(err);
      toast.error('Volume generator failed: ' + (err.message || 'Unknown error'));
    } finally {
      setVolumePendingRun(null);
      setVolumeConfirmMessage('');
      setLoading(prev => ({ ...prev, volumeRun: false }));
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

  const volumeEstimate = volumePlan.length ? estimateWartRequired(volumePlan) : null;

  const tabs = [
    { id: 'market', label: 'Market Data' },
    { id: 'charts', label: 'Price Charts' },
    { id: 'volume', label: 'Volume Generator' },
    { id: 'trading', label: 'Trading Activity' },
    { id: 'deposit', label: 'Liquidity Deposit' },
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

      {activeTab === 'charts' && (
        <section className="border-2 border-violet-500 rounded-3xl p-8 bg-violet-50 dark:bg-violet-950 shadow-xl">
          <h3 className="text-xl font-semibold mb-2 text-violet-700 dark:text-violet-300">
            Asset Price History
          </h3>
          <p className="text-sm text-violet-600 dark:text-violet-400 mb-6">
            Uses <code className="text-violet-300">/chart/candles/:asset/:interval</code> and{' '}
            <code className="text-violet-300">/chart/trades/:asset</code> when the node supports them;
            otherwise builds history from recent DEX matches in <code className="text-violet-300">/transaction/latest</code>.
            Prices are WART per asset token.
          </p>
          {renderPriceChartSection()}
        </section>
      )}

      {activeTab === 'volume' && (
        <section className="border-2 border-amber-500 rounded-3xl p-8 bg-amber-50 dark:bg-amber-950 shadow-xl">
          <h3 className="text-xl font-semibold mb-2 text-amber-700 dark:text-amber-300">
            DEX Volume Generator
          </h3>
          <p className="text-sm text-amber-700/80 dark:text-amber-400 mb-6">
            Place stepped limit orders to generate DEX match volume and price history.
            Buy orders match against pool liquidity; sell orders require asset balance in your wallet.
            Testnet only — use responsibly.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Asset Hash (64 hex, no 0x)</label>
              <input
                id="volumeAssetHash"
                placeholder="Paste asset hash for your pooled token"
                className="input font-mono text-sm"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Strategy</label>
                <select
                  value={volumeStrategy}
                  onChange={(e) => setVolumeStrategy(e.target.value)}
                  className="input"
                >
                  <option value="buys">Buys only (WART → asset, uses pool)</option>
                  <option value="sells">Sells only (asset → WART)</option>
                  <option value="both">Both (sell then buy each round)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Rounds (1–25)</label>
                <input id="volumeRounds" type="number" min="1" max="25" defaultValue="5" className="input" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">WART per buy order</label>
                <input id="volumeBuyWart" type="number" step="any" defaultValue="5" className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Asset per sell order</label>
                <input id="volumeSellAsset" type="number" step="any" defaultValue="10" className="input" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Base price (WART/asset)</label>
                <input id="volumeBasePrice" type="number" step="any" defaultValue="0.1" className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Price step per round</label>
                <input id="volumePriceStep" type="number" step="any" defaultValue="0.01" className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Delay between orders (ms)</label>
                <input id="volumeDelayMs" type="number" min="0" step="100" defaultValue="1500" className="input" />
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={applyPoolSpotPrice}
                className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors"
              >
                Use pool spot price
              </button>
              <button
                type="button"
                onClick={previewVolumePlan}
                disabled={loading.volumePreview || !account}
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-medium transition-colors disabled:bg-gray-500"
              >
                {loading.volumePreview ? 'Loading…' : 'Preview plan'}
              </button>
              <button
                type="button"
                onClick={requestVolumeRun}
                disabled={loading.volumeRun || loading.volumeConfirm || !account}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition-colors disabled:bg-gray-500"
              >
                {loading.volumeRun
                  ? 'Submitting orders…'
                  : loading.volumeConfirm
                    ? 'Preparing…'
                    : 'Run volume generator'}
              </button>
            </div>

            {volumeContext && (
              <div className="p-4 bg-zinc-950/60 border border-amber-800/50 rounded-2xl text-sm space-y-1">
                <div className="font-semibold text-amber-300">{volumeContext.assetName} market snapshot</div>
                <div className="text-zinc-300">
                  Your balance: <span className="font-mono text-white">{formatBalance(volumeContext.balances.wart)}</span> WART
                  {' · '}
                  <span className="font-mono text-white">{formatBalance(volumeContext.balances.asset)}</span> {volumeContext.assetName}
                </div>
                <div className="text-zinc-400">
                  Pool: {formatBalance(volumeContext.pool.wart)} WART / {formatBalance(volumeContext.pool.asset)} {volumeContext.assetName}
                  {volumeContext.spotPriceLabel && (
                    <span> · Spot {volumeContext.spotPriceLabel} WART/{volumeContext.assetName}</span>
                  )}
                </div>
                <div className="text-zinc-500 text-xs">
                  Open orders on book: {volumeContext.openBuys} buys, {volumeContext.openSells} sells
                </div>
              </div>
            )}

            {volumePlan.length > 0 && (
              <div className="border border-amber-800/40 rounded-2xl overflow-hidden">
                <div className="px-4 py-2 bg-amber-950/50 text-sm text-amber-200 flex justify-between items-center">
                  <span>Order plan ({volumePlan.length} orders)</span>
                  {volumeEstimate && (
                    <span className="text-xs text-amber-400/80 font-mono">
                      ~{volumeEstimate.total.toFixed(2)} WART + fees
                    </span>
                  )}
                </div>
                <div className="max-h-48 overflow-auto">
                  <table className="w-full text-xs font-mono">
                    <thead className="bg-zinc-900 text-zinc-400 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">#</th>
                        <th className="text-left px-3 py-2">Side</th>
                        <th className="text-right px-3 py-2">Amount</th>
                        <th className="text-right px-3 py-2">Price</th>
                        <th className="text-right px-3 py-2">Limit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {volumePlan.map((step, idx) => (
                        <tr key={idx} className="border-t border-zinc-800 text-zinc-300">
                          <td className="px-3 py-1.5">{step.round}</td>
                          <td className={`px-3 py-1.5 ${step.side === 'buy' ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {step.side}
                          </td>
                          <td className="px-3 py-1.5 text-right">{step.amount}</td>
                          <td className="px-3 py-1.5 text-right">{formatAssetPrice(step.price)}</td>
                          <td className="px-3 py-1.5 text-right text-zinc-500">{step.limitHex}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {volumeLogs.length > 0 && (
              <div className="border border-zinc-700 rounded-2xl overflow-hidden">
                <div className="px-4 py-2 bg-zinc-900 text-sm text-zinc-300">Execution log</div>
                <ul className="max-h-40 overflow-auto text-xs font-mono p-3 space-y-1">
                  {volumeLogs.map((log, idx) => (
                    <li
                      key={idx}
                      className={
                        log.status === 'ok'
                          ? 'text-emerald-400'
                          : log.status === 'skipped'
                            ? 'text-zinc-500'
                            : 'text-red-400'
                      }
                    >
                      {log.status === 'ok' ? '✓' : log.status === 'skipped' ? '○' : '✗'}
                      {' '}
                      {log.side} #{log.round} @ {formatAssetPrice(log.price)}
                      {log.message ? ` — ${log.message}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!account && (
              <p className="text-sm text-amber-600 dark:text-amber-400 italic">
                Unlock your wallet to preview or submit volume orders.
              </p>
            )}
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
        <section className="border-2 border-cyan-500 rounded-3xl p-8 bg-cyan-50 dark:bg-cyan-950 shadow-xl">
          <h3 className="text-xl font-semibold mb-6 text-cyan-700 dark:text-cyan-300">
            Liquidity Deposit (Asset → WART Pool)
          </h3>
          <p className="text-sm text-cyan-600 dark:text-cyan-400 mb-6">
            Deposit asset tokens + WART into the asset&apos;s liquidity pool.
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
              disabled={loading.poolMarket || loading.myAssetBalance}
              className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-2xl transition-all disabled:bg-gray-400 whitespace-nowrap"
            >
              {loading.poolMarket || loading.myAssetBalance ? 'Loading...' : 'Load Pool & My Position'}
            </button>
          </div>

          {results.poolMarket && renderPoolMarketCard(results.poolMarket)}
          {results.myAssetBalance && renderPositionCard(results.myAssetBalance)}

          {!results.poolMarket && !results.myAssetBalance && (
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
                    onClick={encodeLimitPrice}
                    className="h-[50px] px-8 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-semibold rounded-2xl transition-colors whitespace-nowrap"
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

      <ConfirmDialog
        open={volumeConfirmOpen}
        title="Confirm volume generator"
        message={volumeConfirmMessage}
        confirmText={loading.volumeRun ? 'Submitting…' : 'Submit orders'}
        cancelText="Cancel"
        confirmVariant="danger"
        onConfirm={runVolumeGenerator}
        onCancel={cancelVolumeRun}
      />
    </>
  );
};

export default DexPage;