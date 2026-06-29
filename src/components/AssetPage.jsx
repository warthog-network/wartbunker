import React, { useEffect, useRef, useState } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import FormattedNumber from './FormattedNumber.jsx';
import { isValidAssetHash } from '../utils/warthogFormat';
import {
  createWarthogApi,
  formatSubmitError,
  formatSubmitResult,
  getNodeData,
  signAndSubmitTransaction,
} from '../utils/warthogClient.js';
import {
  CHART_INTERVALS,
  fetchAssetLivePrices,
  loadDexStylePriceChart,
  normalizeChartAssetHash,
} from '../utils/dexPrice.js';
import AssetPriceChart from './AssetPriceChart.jsx';
import { DEFAULT_NODE_URL } from '../utils/presetNodes.js';

const AssetCardWithChart = ({ asset, isCompact, selectedNode, onCopyHash, chartPriority = false }) => {

  const { wallet, watchedAssets, addWatchedAsset } = useWallet();
  const toast = useToast();
  const chartSectionRef = useRef(null);
  const [chartVisible, setChartVisible] = useState(chartPriority);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartPoints, setChartPoints] = useState([]);
  const [chartError, setChartError] = useState(null);
  const [chartFallbackNote, setChartFallbackNote] = useState(null);
  const [chartMode, setChartMode] = useState('candles');
  const [chartInterval, setChartInterval] = useState('1h');
  const [chartLiveView, setChartLiveView] = useState(false);
  const [chartLoadKey, setChartLoadKey] = useState(0);
  const [tradePrice, setTradePrice] = useState(null);
  const [poolSpot, setPoolSpot] = useState(null);
  const chartLoadGenRef = useRef(0);

  const bumpChartLoad = () => setChartLoadKey((key) => key + 1);

  const handleRefreshChart = () => {
    setChartVisible(true);
    setChartLiveView(true);
    bumpChartLoad();
  };

  const handleShowIndexedChart = () => {
    setChartLiveView(false);
    bumpChartLoad();
  };

  useEffect(() => {
    setChartLiveView(false);
    setChartLoadKey(0);
    setTradePrice(null);
    setPoolSpot(null);
    setChartFallbackNote(null);
  }, [asset?.hash]);

  useEffect(() => {
    if (chartPriority) {
      setChartVisible(true);
      return undefined;
    }

    const el = chartSectionRef.current;
    if (!el) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setChartVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [chartPriority, asset?.hash]);

  useEffect(() => {
    const hash = normalizeChartAssetHash(asset?.hash || '');
    if (!chartVisible || !hash || !selectedNode) {
      return undefined;
    }

    const loadGen = ++chartLoadGenRef.current;

    const isLiveView = chartLiveView;

    setChartLoading(true);
    setChartPoints([]);
    setChartError(null);
    setChartFallbackNote(null);
    setTradePrice(null);
    setPoolSpot(null);

    (async () => {
      try {
        const api = await createWarthogApi(selectedNode);
        const chartResult = await loadDexStylePriceChart(api, hash, {
          n: 100,
          mode: 'candles',
          interval: '1h',
          allowFallback: isLiveView,
          liveAugment: isLiveView,
          priority: chartPriority || isLiveView,
        });

        if (loadGen !== chartLoadGenRef.current) return;

        let livePrices = { latestTradePrice: null, poolSpot: null };
        if (isLiveView) {
          livePrices = await fetchAssetLivePrices(api, hash);
        }

        if (loadGen !== chartLoadGenRef.current) return;

        const {
          points,
          error,
          usedFallback,
          mode,
          interval,
          liveAugment,
          poolSpotOnly,
          poolSpot: chartPoolSpot,
        } = chartResult;

        if (isLiveView) {
          setTradePrice(livePrices.latestTradePrice);
          setPoolSpot(livePrices.poolSpot ?? chartPoolSpot ?? null);
        }

        setChartPoints(points);
        setChartError(points.length ? null : error);
        setChartMode(mode);
        setChartInterval(interval);
        if (poolSpotOnly) {
          setChartFallbackNote(
            'Chart index has not synced this asset yet — showing current pool spot price from DEX reserves.',
          );
        } else if (liveAugment) {
          setChartFallbackNote(
            'Latest candle includes recent matches and pool spot — node chart index can lag a few blocks behind.',
          );
        } else if (usedFallback) {
          setChartFallbackNote(
            'Chart history unavailable — showing DEX match trades from recent blocks.',
          );
        }
      } catch (err) {
        if (loadGen !== chartLoadGenRef.current) return;
        setChartError(err.message || 'Failed to load price chart');
      } finally {
        if (loadGen === chartLoadGenRef.current) {
          setChartLoading(false);
        }
      }
    })();

    return () => {
      chartLoadGenRef.current += 1;
    };
  }, [chartVisible, asset?.hash, selectedNode, chartPriority, chartLiveView, chartLoadKey]);

  const intervalLabel = chartMode === 'trades'
    ? 'Trades'
    : (CHART_INTERVALS.find((i) => i.id === chartInterval)?.label || chartInterval);

  if (!asset) return null;


  const hash = asset.hash || '';
  const isTracked = watchedAssets.some((w) => w.hash.toLowerCase() === hash.toLowerCase());

  const handleTrackAsset = () => {
    if (!wallet?.address) {
      toast.error('Connect a wallet to track tokens');
      return;
    }
    if (isTracked) return;
    addWatchedAsset(hash, asset.name || '');
    toast.success(`${asset.name || 'Token'} added to your wallet`);
  };

  return (
    <div className="w-full bg-zinc-950 border border-zinc-700 rounded-2xl overflow-hidden">
      <div className={isCompact ? 'p-4' : 'p-5'}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-500 via-cyan-500 to-teal-500 flex items-center justify-center text-white font-bold text-2xl shadow-inner ring-1 ring-white/20">
              {asset.name?.[0] || 'A'}
            </div>
            <div>
              <div className="font-bold text-2xl tracking-tight text-white">{asset.name}</div>
              <div className="text-xs text-zinc-400 font-mono -mt-1">Asset ID {asset.id}</div>
            </div>
          </div>
          <div
            onClick={() => onCopyHash(hash)}
            className="text-right cursor-pointer group"
          >
            <div className="text-xs font-mono text-zinc-400 group-hover:text-blue-400 transition-colors">
              {hash.slice(0, 10)}…{hash.slice(-8)}
            </div>
            <div className="text-[10px] text-zinc-500 group-hover:text-zinc-400">Copy Hash</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <div className="text-xs text-zinc-400 mb-0.5">Decimals</div>
            <div className="font-mono font-medium text-white">{asset.decimals}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-400 mb-0.5">Block Height</div>
            <div className="font-mono font-medium text-white">{asset.height}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-400 mb-0.5">Total Supply</div>
            <FormattedNumber value={asset.totalSupply?.str || '0'} variant="balance" className="font-medium" />
          </div>
          <div>
            <div className="text-xs text-zinc-400 mb-0.5">Owner Account</div>
            <div className="font-mono font-medium text-white">#{asset.ownerAccountId}</div>
          </div>
          {asset.groupId != null && (
            <div>
              <div className="text-xs text-zinc-400 mb-0.5">Group ID</div>
              <div className="font-mono font-medium text-white">{asset.groupId}</div>
            </div>
          )}
          {asset.parentId != null && (
            <div>
              <div className="text-xs text-zinc-400 mb-0.5">Parent ID</div>
              <div className="font-mono font-medium text-white">{asset.parentId}</div>
            </div>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-zinc-700 text-xs text-zinc-400 flex items-center justify-between gap-2 flex-wrap">
          <span>Created on-chain</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTrackAsset}
              disabled={isTracked}
              className={`compact-btn !mx-0 !my-0 !px-3 !py-1 whitespace-nowrap ${
                isTracked
                  ? 'text-emerald-400 cursor-default opacity-80'
                  : 'hover:!text-[#E79300]'
              }`}
              title={
                isTracked
                  ? 'Already in your wallet'
                  : wallet?.address
                    ? 'Add to tracked tokens'
                    : 'Log in to track this token'
              }
            >
              {isTracked ? '✓ Tracked' : '+ Track in Wallet'}
            </button>
            <button
              type="button"
              onClick={() => onCopyHash(hash)}
              className="compact-btn text-blue-400 hover:!text-blue-300"
            >
              Copy Full Hash
            </button>
          </div>
        </div>
      </div>

      <div ref={chartSectionRef} className="border-t border-zinc-700 bg-zinc-900/40">
        <div className="px-4 pt-3 flex items-start justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-violet-400/90 pt-0.5">
            Price chart
          </span>
          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              {chartLiveView && (
                <button
                  type="button"
                  className="compact-btn text-zinc-400 hover:!text-zinc-200"
                  onClick={handleShowIndexedChart}
                  disabled={chartLoading}
                  title="Return to node-indexed chart candles"
                >
                  {chartLoading ? 'Loading…' : '↩ Indexed'}
                </button>
              )}
              <button
                type="button"
                className={`compact-btn hover:!text-violet-200 ${
                  chartLiveView ? 'compact-btn--active text-violet-200' : 'text-violet-300'
                }`}
                onClick={handleRefreshChart}
                disabled={chartLoading}
                title="Reload chart with latest matches and pool price"
              >
                {chartLoading && chartLiveView ? 'Refreshing…' : '↻ Refresh'}
              </button>
            </div>
            <p className="text-[10px] text-zinc-500 leading-tight text-right">
              {chartLiveView ? 'Switch back to indexed candles' : 'Live trades & pool spot'}
            </p>
          </div>
        </div>
        {chartFallbackNote && (
          <p className="px-4 pb-1 text-xs text-amber-400/90">{chartFallbackNote}</p>
        )}
        {!chartVisible ? (
          <div className="p-6 text-center text-xs text-zinc-500">Scroll into view to load chart…</div>
        ) : (
          <AssetPriceChart
            points={chartPoints}
            mode={chartMode}
            assetName={asset?.name || 'Asset'}
            intervalLabel={intervalLabel}
            loading={chartLoading}
            error={chartError}
            embedded
            tradePrice={tradePrice}
            poolSpot={poolSpot}
            candleInterval={chartInterval}
          />
        )}
      </div>
    </div>
  );
};

const AssetPage = ({ selectedNode: propSelectedNode, wallet: propWallet }) => {
  const {
    wallet: contextWallet,
    nextNonce: contextNextNonce,
    selectedNode: contextSelectedNode,
    isSigningUnlocked,
    isSessionLocked,
  } = useWallet();

  const wallet = propWallet || contextWallet;
  const selectedNode = propSelectedNode || contextSelectedNode || DEFAULT_NODE_URL;

  const toast = useToast();

  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});
  const [activeTab, setActiveTab] = useState('create');
  const [searchLookupMode, setSearchLookupMode] = useState('name');

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

  // Simple copy helper (local to this component)
  const copyToClipboard = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Copied to clipboard');
    }).catch(() => toast.error('Failed to copy'));
  };

  // ==================== CREATE ASSET ====================
  const handleCreateAsset = async () => {
    const nameInput = document.getElementById('assetName').value.trim().toUpperCase();
    const supplyStr = document.getElementById('assetSupply').value.trim();
    const decimalsInput = parseInt(document.getElementById('assetDecimals').value) || 8;

    if (!nameInput || nameInput.length < 1 || nameInput.length > 5) {
      toast.error('Asset name must be 1-5 uppercase characters (e.g. HOG)');
      return;
    }
    if (!supplyStr || parseFloat(supplyStr) <= 0) {
      toast.error('Please enter a valid total supply greater than 0');
      return;
    }
    if (!isSigningUnlocked) {
      toast.error(isSessionLocked ? 'Unlock your wallet to create assets' : 'Wallet not loaded. Please log in again.');
      return;
    }

    setLoading(prev => ({ ...prev, createAsset: true }));
    setResults(prev => ({ ...prev, createAsset: null }));

    try {
      let nonceId = getSmartNonce();
      const nonceOverrideRaw = document.getElementById('createNonceOverride')?.value.trim();
      if (nonceOverrideRaw !== '') {
        const parsed = parseInt(nonceOverrideRaw, 10);
        if (!Number.isNaN(parsed)) {
          nonceId = parsed;
        }
      }

      const api = await createWarthogApi(selectedNode);
      const { nonce, data } = await signAndSubmitTransaction(api, {
        nonceId,
        buildSpec: {
          type: 'ASSET_CREATE',
          name: nameInput,
          supply: supplyStr,
          decimals: decimalsInput,
        },
      });

      setResults(prev => ({ ...prev, createAsset: formatSubmitResult(data) }));
      updateNonceAfterSuccess(nonce);

      if (document.getElementById('createNonceOverride')) {
        document.getElementById('createNonceOverride').value = '';
      }

      toast.success('Asset creation transaction sent — check History tab');
      document.getElementById('assetName').value = '';
      document.getElementById('assetSupply').value = '';
    } catch (err) {
      console.error(err);
      const errorDetail = err.message;
      setResults(prev => ({ ...prev, createAsset: formatSubmitError(errorDetail) }));
      toast.error('Failed to create asset: ' + errorDetail);
    } finally {
      setLoading(prev => ({ ...prev, createAsset: false }));
    }
  };

  const tabs = [
    { id: 'create', label: 'Create Asset' },
    { id: 'search', label: 'Search & Lookup' },
  ];

  return (
    <div className="space-y-8">
      <h2 className="text-3xl font-bold">Asset Tools</h2>
      <p className="mb-6 text-gray-600 dark:text-gray-400">
        Create, search, and look up assets on the DeFi testnet. Send assets from the Send tab.
      </p>

      {/* SUB TABS - consistent with DexPage styling */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1 whitespace-nowrap${
              activeTab === tab.id ? ' compact-btn--active' : ''
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* CREATE ASSET TAB */}
      {activeTab === 'create' && (
        <section className="border-2 border-blue-500 rounded-3xl p-8 bg-blue-50 dark:bg-blue-950 shadow-xl">
          <h3 className="text-2xl font-bold mb-6 text-blue-700 dark:text-blue-300">Create New Asset</h3>
          <div>
              <label className="block text-sm font-medium mb-2">Asset Name (1-5 chars)</label>
              <input id="assetName" maxLength="5" placeholder="e.g. LIQ" className="input mb-4" />

              <label className="block text-sm font-medium mb-2">Total Supply</label>
              <input id="assetSupply" type="number" placeholder="1000000000" className="input mb-4" />

              <label className="block text-sm font-medium mb-2">Decimals</label>
              <input id="assetDecimals" type="number" defaultValue="8" className="input mb-6" />

              <label className="block text-sm font-medium mb-2 text-amber-400">
                Nonce Override (only use if you get "Duplicate nonce")
              </label>
              <input 
                id="createNonceOverride" 
                type="number" 
                placeholder="Leave empty for auto" 
                className="input mb-6" 
              />

              <button
                onClick={handleCreateAsset}
                disabled={loading.createAsset}
                className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !px-3 !py-1"
              >
                {loading.createAsset ? 'Creating Asset...' : 'Create Asset'}
              </button>

              {results.createAsset && renderTransactionResult(results.createAsset, 'Asset Creation')}
          </div>
        </section>
      )}

      {/* SEARCH & LOOKUP TAB */}
      {activeTab === 'search' && (
        <div className="space-y-4">
          <section className="border-2 border-violet-500 rounded-3xl p-8 bg-violet-50 dark:bg-violet-950 shadow-xl">
            <h3 className="text-2xl font-bold mb-2 text-violet-700 dark:text-violet-300">Asset Search & Lookup</h3>
            <p className="text-sm text-violet-600/80 dark:text-violet-400/80 mb-5">
              Find assets by name prefix, hash prefix, or exact 64-character hash.
            </p>

            <div className="flex items-center gap-2 mb-5 flex-wrap">
              {[
                { id: 'name', label: 'Search by name' },
                { id: 'hashMatch', label: 'Hash prefix match' },
                { id: 'lookup', label: 'Lookup by hash' },
              ].map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    setSearchLookupMode(mode.id);
                    setResults((prev) => ({
                      ...prev,
                      assetComplete: mode.id === 'lookup' ? undefined : prev.assetComplete,
                      assetLookup: mode.id !== 'lookup' ? undefined : prev.assetLookup,
                    }));
                  }}
                  className={`compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1 whitespace-nowrap${
                    searchLookupMode === mode.id ? ' compact-btn--active' : ''
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {searchLookupMode === 'name' && (
              <div className="space-y-3 max-w-xl">
                <div className="form-group !mb-0">
                  <label>Name prefix <span className="text-zinc-500 font-normal">(leave empty to list all)</span></label>
                  <input id="namePrefix" placeholder="e.g. BUN — or leave blank for all assets" className="input" />
                </div>
                <div className="form-group !mb-0">
                  <label>Hash prefix <span className="text-zinc-500 font-normal">(optional)</span></label>
                  <input id="nameHashPrefix" placeholder="First hex chars of asset hash" className="input font-mono text-sm" />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const name = document.getElementById('namePrefix').value.trim();
                    const hash = document.getElementById('nameHashPrefix').value.trim().replace(/^0x/i, '');
                    let path = `asset/complete?namePrefix=${encodeURIComponent(name)}`;
                    if (hash) path += `&hashPrefix=${encodeURIComponent(hash)}`;
                    query('assetComplete', path);
                  }}
                  disabled={loading.assetComplete}
                  className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !px-3 !py-1"
                >
                  {loading.assetComplete ? 'Querying…' : 'Query'}
                </button>
              </div>
            )}

            {searchLookupMode === 'hashMatch' && (
              <div className="space-y-3 max-w-xl">
                <div className="form-group !mb-0">
                  <label>Hash prefix</label>
                  <input
                    id="hashMatchPrefix"
                    placeholder="e.g. 67be5795"
                    className="input font-mono text-sm"
                  />
                </div>
                <div className="form-group !mb-0">
                  <label>Name prefix <span className="text-zinc-500 font-normal">(optional filter)</span></label>
                  <input id="hashMatchNamePrefix" placeholder="Narrow by asset name" className="input" />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const hashPrefix = document.getElementById('hashMatchPrefix').value.trim().replace(/^0x/i, '');
                    if (!hashPrefix) {
                      toast.error('Enter a hash prefix');
                      return;
                    }
                    const namePrefix = document.getElementById('hashMatchNamePrefix').value.trim();
                    let path = `asset/complete?hashPrefix=${encodeURIComponent(hashPrefix)}`;
                    if (namePrefix) {
                      path += `&namePrefix=${encodeURIComponent(namePrefix)}`;
                    } else {
                      path += '&namePrefix=';
                    }
                    query('assetComplete', path);
                  }}
                  disabled={loading.assetComplete}
                  className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !px-3 !py-1"
                >
                  {loading.assetComplete ? 'Querying…' : 'Query'}
                </button>
              </div>
            )}

            {searchLookupMode === 'lookup' && (
              <div className="space-y-3 max-w-xl">
                <div className="form-group !mb-0">
                  <label>Asset hash</label>
                  <input
                    id="assetLookup"
                    placeholder="64 hex characters (no 0x)"
                    className="input font-mono text-sm"
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      const val = document.getElementById('assetLookup').value.trim();
                      const clean = val.replace(/^0x/i, '').toLowerCase();
                      if (!isValidAssetHash(clean)) {
                        toast.error('Asset hash must be exactly 64 hex characters');
                        return;
                      }
                      query('assetLookup', `asset/lookup/${encodeURIComponent(clean)}`);
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const val = document.getElementById('assetLookup').value.trim();
                    const clean = val.replace(/^0x/i, '').toLowerCase();
                    if (!isValidAssetHash(clean)) {
                      toast.error('Asset hash must be exactly 64 hex characters');
                      return;
                    }
                    query('assetLookup', `asset/lookup/${encodeURIComponent(clean)}`);
                  }}
                  disabled={loading.assetLookup}
                  className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !px-3 !py-1"
                >
                  {loading.assetLookup ? 'Querying…' : 'Query'}
                </button>
              </div>
            )}
          </section>

          {searchLookupMode !== 'lookup' && results.assetComplete && results.assetComplete.code === 0 && results.assetComplete.data?.matches?.length > 0 && (
            <div className="space-y-3 w-full">
              <div className="text-sm text-zinc-400 px-1">
                Found <span className="font-semibold text-white">{results.assetComplete.data.matches.length}</span> match{results.assetComplete.data.matches.length !== 1 ? 'es' : ''}
                {results.assetComplete.data.namePrefix
                  ? ` for “${results.assetComplete.data.namePrefix}”`
                  : results.assetComplete.data.hashPrefix
                    ? ` with hash prefix “${results.assetComplete.data.hashPrefix}”`
                    : ' (all assets)'}
              </div>
              {results.assetComplete.data.matches.map((asset) => (
                <AssetCardWithChart
                  key={asset.hash || asset.id}
                  asset={asset}
                  isCompact
                  selectedNode={selectedNode}
                  onCopyHash={copyToClipboard}
                />
              ))}
            </div>
          )}

          {searchLookupMode !== 'lookup' && results.assetComplete && results.assetComplete.code === 0 && results.assetComplete.data?.matches?.length === 0 && (
            <div className="p-4 bg-zinc-950 border border-zinc-700 rounded-2xl text-center text-sm text-zinc-400 w-full">
              No assets found matching your search.
            </div>
          )}

          {searchLookupMode !== 'lookup' && results.assetComplete && results.assetComplete.error && (
            <div className="p-4 bg-red-950/40 border border-red-700 rounded-2xl text-sm text-red-400 w-full">
              {results.assetComplete.error}
            </div>
          )}

          {searchLookupMode === 'lookup' && results.assetLookup && results.assetLookup.code === 0 && results.assetLookup.data && (
            <div className="w-full">
              <AssetCardWithChart
                asset={results.assetLookup.data}
                chartPriority
                selectedNode={selectedNode}
                onCopyHash={copyToClipboard}
              />
            </div>
          )}

          {searchLookupMode === 'lookup' && results.assetLookup && results.assetLookup.code === 0 && !results.assetLookup.data && (
            <div className="p-4 bg-zinc-950 border border-zinc-700 rounded-2xl text-center text-sm text-zinc-400 w-full">
              Asset not found.
            </div>
          )}

          {searchLookupMode === 'lookup' && results.assetLookup && results.assetLookup.error && (
            <div className="p-4 bg-red-950/40 border border-red-700 rounded-2xl text-sm text-red-400 w-full">
              {results.assetLookup.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AssetPage;