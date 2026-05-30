import React, { useState } from 'react';
import axios from 'axios';
import { ethers } from 'ethers';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';

const API_URL = '/api/proxy';

const DexPage = ({ selectedNode: propSelectedNode, wallet: propWallet }) => {
  const {
    nextNonce: contextNextNonce,
    pinHeight,
    pinHash,
    selectedNode: contextSelectedNode,
  } = useWallet();

  const selectedNode = propSelectedNode || contextSelectedNode || 'https://warthognode.duckdns.org';

  const wallet = propWallet || (sessionStorage.getItem('warthogWalletDecrypted')
    ? JSON.parse(sessionStorage.getItem('warthogWalletDecrypted'))
    : null);

  const toast = useToast();

  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});

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

  // NEW: Clean, human-friendly balance formatter (removes trailing .00000000 etc.)
  const formatBalance = (v) => {
    let s = safeStr(v, '0');
    if (typeof s !== 'string') s = String(s || '0');
    if (!s.includes('.')) return s;
    // Trim insignificant trailing zeros while preserving meaningful precision
    // 476990.00000000 → 476990
    // 123.45600000  → 123.456
    // 0.0001234500  → 0.00012345
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

  // ==================== ENHANCED QUERY ====================
  const query = async (key, path, method = 'GET', data = null) => {
    setLoading(prev => ({ ...prev, [key]: true }));
    try {
      const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;
      const config = {
        method,
        url: `${API_URL}?nodePath=${path}&${nodeBaseParam}`,
      };
      if (data) {
        config.data = data;
        config.headers = { 'Content-Type': 'application/json' };
      }
      const response = await axios(config);
      setResults(prev => ({ ...prev, [key]: response.data }));
      return response.data;
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message;
      setResults(prev => ({ ...prev, [key]: { error: errorMsg } }));
      throw err;
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  const account = wallet?.address || '';

  // ==================== BINARY HELPERS ====================
  const hexToBytes = (hex) => {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return bytes;
  };

  const uint32BE = (value) => {
    const buf = new Uint8Array(4);
    buf[0] = (value >>> 24) & 0xff;
    buf[1] = (value >>> 16) & 0xff;
    buf[2] = (value >>> 8) & 0xff;
    buf[3] = value & 0xff;
    return buf;
  };

  const uint64BE = (value) => {
    const buf = new Uint8Array(8);
    let v = BigInt(value);
    for (let i = 7; i >= 0; i--) {
      buf[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    return buf;
  };

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

    const isSuccess = result.code === 0 || !result.error;
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
            <div className="text-xs text-zinc-400">Transaction sent to node • Check History tab for confirmation</div>
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
      
      let priceRaw = d.price || d.spotPrice || d.doubleAdjustedPrice || d.marketPrice;
      let price = safeStr(priceRaw, '—');
      if (price === '—' && priceRaw && typeof priceRaw === 'object') {
        price = priceRaw.doubleAdjusted != null ? String(priceRaw.doubleAdjusted) : price;
      }
      
      const tvl = d.tvl || d.totalLiquidity || d.liquidityWart || null;

      return (
        <div className="mt-6 bg-zinc-950 border border-emerald-700/60 rounded-3xl overflow-hidden shadow-xl">
          {/* Header */}
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
            {/* Key Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {/* WART Reserve */}
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

              {/* Asset Reserve */}
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

              {/* Spot Price */}
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

            {/* Compact Stats Row */}
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

            {/* Open Orders — collapsed by default */}
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

            {/* Raw toggle for advanced users */}
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

  // ==================== MY LIQUIDITY POSITION CARD (FIXED RESPONSIVE + CLEAN NUMBER) ====================
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
          {/* RESPONSIVE LAYOUT: stacked on mobile, side-by-side on sm+ */}
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between mb-4 gap-1 sm:gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-emerald-400 text-xs tracking-[2px] font-medium">YOUR LIQUIDITY POSITION</div>
              {/* Smaller base size + responsive scale. break-all only on mobile to prevent cutoff */}
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

  // ==================== LIQUIDITY DEPOSIT ====================
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

    let assetHash = assetHashRaw;
    if (assetHash.toLowerCase().startsWith('0x')) assetHash = assetHash.slice(2);
    if (assetHash.length !== 64) {
      toast.error('Asset Hash must be exactly 64 hex characters (without 0x)');
      return;
    }

    const assetAmountFloat = parseFloat(assetAmountStr.replace(',', '.'));
    const decimals = parseInt(decimalsStr) || 8;
    if (!Number.isFinite(assetAmountFloat) || assetAmountFloat <= 0) {
      toast.error('Please enter a valid Asset Amount greater than 0');
      return;
    }
    const amountU64 = Math.floor(assetAmountFloat * Math.pow(10, decimals));

    const wartAmountFloat = parseFloat(wartAmountStr.replace(',', '.'));
    if (!Number.isFinite(wartAmountFloat) || wartAmountFloat < 0) {
      toast.error('Please enter a valid WART Amount');
      return;
    }
    const wartE8 = Math.floor(wartAmountFloat * 100000000);

    setLoading(prev => ({ ...prev, liquidityDeposit: true }));

    try {
      const currentPinHeight = pinHeight || 0;
      const currentPinHash = pinHash || '000000000000000000000im0000000000000000000000000000000000000000';

      const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;

      const minFeeRes = await axios.get(`${API_URL}?nodePath=transaction/minfee&${nodeBaseParam}`);
      const minFeeE8 = minFeeRes.data?.data?.minFee?.E8 || minFeeRes.data?.minFee?.E8 || 10000;

      const binaryParts = [
        hexToBytes(currentPinHash),
        uint32BE(currentPinHeight),
        uint32BE(nonceId),
        new Uint8Array(3),
        uint64BE(BigInt(minFeeE8)),
        hexToBytes(assetHash),
        uint64BE(BigInt(amountU64)),
        uint64BE(BigInt(wartE8)),
      ];

      const totalLength = binaryParts.reduce((sum, part) => sum + part.length, 0);
      const binary = new Uint8Array(totalLength);
      let offset = 0;
      for (const part of binaryParts) {
        binary.set(part, offset);
        offset += part.length;
      }

      const hashHex = ethers.sha256(binary);
      const hash = hashHex.slice(2);

      const signer = new ethers.Wallet(wallet.privateKey);
      const signature = await signer.signingKey.sign(ethers.getBytes('0x' + hash));

      const r = signature.r.slice(2).padStart(64, '0');
      const s = signature.s.slice(2).padStart(64, '0');
      const v = (signature.v - 27).toString(16).padStart(2, '0');
      const signature65 = r + s + v;

      const payload = {
        type: "liquidityDeposit",
        assetHash: assetHash,
        amountU64: amountU64,
        wartE8: wartE8,
        feeE8: Number(minFeeE8),
        pinHeight: currentPinHeight,
        nonceId: nonceId,
        signature65: signature65,
      };

      console.log('=== LIQUIDITY DEPOSIT PAYLOAD ===', payload);

      await query('liquidityDeposit', 'transaction/add', 'POST', payload);

      updateNonceAfterSuccess(nonceId);

      if (document.getElementById('liquidityNonceOverride')) {
        document.getElementById('liquidityNonceOverride').value = '';
      }

      toast.success('Liquidity deposit sent — check pool info below');
    } catch (err) {
      console.error(err);
      toast.error('Liquidity deposit failed: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(prev => ({ ...prev, liquidityDeposit: false }));
    }
  };

  // ==================== LOAD POOL INFO + MY LIQUIDITY POSITION ====================
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

  // ==================== LIMIT SWAP ====================
  const handleLimitSwap = async () => {
    const assetHashRaw = document.getElementById('limitAssetHash')?.value.trim() || '';
    const isBuy = document.getElementById('limitIsBuy')?.checked ?? true;
    const amountStr = document.getElementById('limitAmount')?.value.trim() || '';
    const limitHex = document.getElementById('limitEncoded')?.value.trim() || '';

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

    let assetHash = assetHashRaw;
    if (assetHash.toLowerCase().startsWith('0x')) assetHash = assetHash.slice(2);
    if (assetHash.length !== 64) {
      toast.error('Asset Hash must be exactly 64 hex characters (without 0x)');
      return;
    }
    if (limitHex.length !== 6) {
      toast.error('Limit price must be exactly 6 hex characters (3 bytes)');
      return;
    }

    const amountU64 = Math.floor(parseFloat(amountStr) * 100000000);

    setLoading(prev => ({ ...prev, limitSwap: true }));

    try {
      const currentPinHeight = pinHeight || 0;
      const currentPinHash = pinHash || '000000000000000000000000000000000im0000000000000000000000000000000';

      const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;

      const minFeeRes = await axios.get(`${API_URL}?nodePath=transaction/minfee&${nodeBaseParam}`);
      const minFeeE8 = minFeeRes.data?.data?.minFee?.E8 || minFeeRes.data?.minFee?.E8 || 10000;

      const isBuyByte = new Uint8Array([isBuy ? 1 : 0]);
      const limitBytes = hexToBytes(limitHex);

      const binaryParts = [
        hexToBytes(currentPinHash),
        uint32BE(currentPinHeight),
        uint32BE(nonceId),
        new Uint8Array(3),
        uint64BE(BigInt(minFeeE8)),
        hexToBytes(assetHash),
        isBuyByte,
        uint64BE(BigInt(amountU64)),
        limitBytes,
      ];

      const totalLength = binaryParts.reduce((sum, part) => sum + part.length, 0);
      const binary = new Uint8Array(totalLength);
      let offset = 0;
      for (const part of binaryParts) {
        binary.set(part, offset);
        offset += part.length;
      }

      const hashHex = ethers.sha256(binary);
      const hash = hashHex.slice(2);

      const signer = new ethers.Wallet(wallet.privateKey);
      const signature = await signer.signingKey.sign(ethers.getBytes('0x' + hash));

      const r = signature.r.slice(2).padStart(64, '0');
      const s = signature.s.slice(2).padStart(64, '0');
      const v = (signature.v - 27).toString(16).padStart(2, '0');
      const signature65 = r + s + v;

      const payload = {
        type: "limitSwap",
        assetHash: assetHash,
        isBuy: isBuy,
        amountU64: amountU64,
        limit: limitHex,
        feeE8: Number(minFeeE8),
        pinHeight: currentPinHeight,
        nonceId: nonceId,
        signature65: signature65,
      };

      console.log('=== LIMIT SWAP PAYLOAD ===', payload);

      await query('limitSwap', 'transaction/add', 'POST', payload);

      updateNonceAfterSuccess(nonceId);

      if (document.getElementById('limitNonceOverride')) {
        document.getElementById('limitNonceOverride').value = '';
      }

      toast.success('Limit order submitted successfully');
    } catch (err) {
      console.error(err);
      toast.error('Limit order failed: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(prev => ({ ...prev, limitSwap: false }));
    }
  };

  // ==================== FIXED PRICE ENCODER ====================
  const encodeLimitPrice = async () => {
    const priceStr = document.getElementById('limitPriceHuman')?.value.trim();
    const decimalsStr = document.getElementById('limitPriceDecimals')?.value.trim() || '8';

    if (!priceStr) {
      toast.error('Please enter a price');
      return;
    }

    try {
      const res = await axios.get(
        `${API_URL}?nodePath=tools/parse_price/${encodeURIComponent(priceStr)}/${decimalsStr}&nodeBase=${encodeURIComponent(selectedNode)}`
      );

      console.log("Full /tools/parse_price response:", res.data);

      const encoded = res.data?.data?.floor?.hex || res.data?.data?.ceil?.hex;

      if (encoded && encoded.length === 6) {
        document.getElementById('limitEncoded').value = encoded;
        toast.success(`Encoded limit: ${encoded}`);
      } else {
        toast.error("Could not extract encoded limit (see console)");
        console.warn("Unexpected response format:", res.data);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to encode price: ' + (err.response?.data?.message || err.message));
    }
  };

  return (
    <>
      {/* === SECTION 1: Market Data === */}
      <section className="border-2 border-green-500 rounded-3xl p-8 bg-green-50 dark:bg-green-950 shadow-xl mb-10">
        <h2 className="text-2xl font-bold mb-6">DEX Tools</h2>
        <p className="mb-6 text-gray-600 dark:text-gray-400">
          Query decentralized exchange markets and trading data.
        </p>

        <h3 className="text-xl font-semibold mb-4 text-green-700 dark:text-green-300">
          Market Data
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">Market Identifier</label>
            <input id="market" placeholder="market identifier or asset hash" className="input mb-4" />
            <button
              onClick={() => query('dexMarket', `dex/market/${encodeURIComponent(document.getElementById('market').value)}`)}
              disabled={loading.dexMarket}
              className="px-6 py-3 mx-2 my-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded-2xl transition-colors"
              style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}
            >
              {loading.dexMarket ? 'Querying...' : 'Query Market'}
            </button>
            
            {results.dexMarket && renderPoolMarketCard(results.dexMarket)}
          </div>
        </div>
      </section>

      {/* === SECTION 2: Trading Activity === */}
      <section className="border-2 border-orange-500 rounded-3xl p-8 bg-orange-50 dark:bg-orange-950 shadow-xl">
        <h3 className="text-xl font-semibold mb-6 text-orange-700 dark:text-orange-300">
          Trading Activity
        </h3>
        <p className="text-sm text-orange-600 dark:text-orange-400 mb-6">
          Uses your connected wallet address
        </p>

        <div className="space-y-8">
          {/* Open Orders */}
          <div>
            <button
              onClick={() => query('openOrders', `account/${account}/open_orders`)}
              disabled={loading.openOrders || !account}
              className="px-6 py-3 mx-2 my-1 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-2xl transition-colors disabled:bg-gray-400"
              style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}
            >
              {loading.openOrders ? 'Loading...' : 'View All Open Orders'}
            </button>
            
            {results.openOrders && renderOpenOrdersCompact(results.openOrders)}
          </div>

          {/* Open Orders for Specific Asset */}
          <div>
            <label className="block text-sm font-medium mb-2">Open Orders for Specific Asset</label>
            <input id="assetForOrders" placeholder="asset identifier" className="input mb-3" />
            <button
              onClick={() => query('openOrdersAsset', `account/${account}/open_orders/${encodeURIComponent(document.getElementById('assetForOrders').value)}`)}
              disabled={!account}
              className="px-6 py-3 mx-2 my-1 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-2xl transition-colors disabled:bg-gray-400"
              style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}
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

          {/* Mempool */}
          <div>
            <button
              onClick={() => query('mempool', `account/${account}/mempool`)}
              disabled={loading.mempool || !account}
              className="px-6 py-3 mx-2 my-1 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-2xl transition-colors disabled:bg-gray-400"
              style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}
            >
              {loading.mempool ? 'Loading...' : 'View Mempool'}
            </button>
            {results.mempool && (
              <pre className="result mt-4 text-xs">{JSON.stringify(results.mempool, null, 2)}</pre>
            )}
          </div>
        </div>
      </section>

      {/* === SECTION 3: Liquidity Deposit === */}
      <section className="border-2 border-cyan-500 rounded-3xl p-8 bg-cyan-50 dark:bg-cyan-950 shadow-xl mt-10">
        <h3 className="text-xl font-semibold mb-6 text-cyan-700 dark:text-cyan-300">
          Liquidity Deposit (Asset → WART Pool)
        </h3>
        <p className="text-sm text-cyan-600 dark:text-cyan-400 mb-6">
          Deposit asset tokens + WART into the asset&apos;s liquidity pool.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
        </div>
      </section>

      {/* === SECTION 4: Pool Info & My Liquidity Position === */}
      <section className="border-2 border-emerald-500 rounded-3xl p-8 bg-emerald-50 dark:bg-emerald-950 shadow-xl mt-10">
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

      {/* === SECTION 5: Limit Orders (Buy/Sell) === */}
      <section className="border-2 border-violet-500 rounded-3xl p-8 bg-violet-50 dark:bg-violet-950 shadow-xl mt-10">
        <h3 className="text-xl font-semibold mb-6 text-violet-700 dark:text-violet-300">
          Limit Orders (Buy / Sell)
        </h3>
        <p className="text-sm text-violet-600 dark:text-violet-400 mb-6">
          Create buy or sell limit orders. Use the price encoder to generate the 6-character limit hex.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
        </div>
      </section>
    </>
  );
};

export default DexPage;
