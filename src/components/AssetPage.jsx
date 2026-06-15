import React, { useState } from 'react';
import axios from 'axios';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import { isValidAssetHash } from '../utils/warthogFormat';

const API_URL = '/api/proxy';

const AssetPage = ({ selectedNode: propSelectedNode, wallet: propWallet }) => {
  const {
    wallet: contextWallet,
    nextNonce: contextNextNonce,
    pinHeight,
    pinHash,
    selectedNode: contextSelectedNode,
    performFakeMine,
    isTestnetNode,
  } = useWallet();

  const wallet = propWallet || contextWallet;
  const selectedNode = propSelectedNode || contextSelectedNode || 'https://warthognode.duckdns.org';

  const toast = useToast();

  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});
  const [activeTab, setActiveTab] = useState('create');

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

  const fetchMinFeeE8 = async () => {
    const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;
    const minFeeRes = await axios.get(`${API_URL}?nodePath=transaction/minfee&${nodeBaseParam}`);
    const minFeeE8 = minFeeRes.data?.data?.minFee?.E8 || minFeeRes.data?.minFee?.E8;
    if (!minFeeE8) {
      throw new Error('Could not fetch minimum fee');
    }
    return minFeeE8;
  };

  // ==================== STYLIZED ASSET CARD ====================
  const renderAssetCard = (asset, isCompact = false) => {
    if (!asset) return null;

    const supply = asset.totalSupply?.str || '0';
    const hash = asset.hash || '';

    return (
      <div className={`bg-zinc-950 border border-zinc-700 rounded-2xl overflow-hidden ${isCompact ? 'p-4' : 'p-5'}`}>
        {/* Header */}
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
            onClick={() => copyToClipboard(hash)}
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
            <div className="font-mono font-medium text-emerald-400 tabular-nums">{supply}</div>
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

        <div className="mt-4 pt-3 border-t border-zinc-700 text-xs text-zinc-400 flex items-center justify-between">
          <span>Created on-chain</span>
          <button 
            onClick={() => copyToClipboard(hash)}
            className="px-3 py-1 rounded-lg hover:bg-zinc-800 text-blue-400 hover:text-blue-300 transition-colors text-xs font-medium"
          >
            Copy Full Hash
          </button>
        </div>
      </div>
    );
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
    if (!wallet?.privateKey) {
      toast.error('Wallet not loaded. Please log in again.');
      return;
    }

    setLoading(prev => ({ ...prev, createAsset: true }));

    try {
      let nonceId = getSmartNonce();
      const nonceOverrideRaw = document.getElementById('createNonceOverride')?.value.trim();
      if (nonceOverrideRaw !== '') {
        const parsed = parseInt(nonceOverrideRaw, 10);
        if (!Number.isNaN(parsed)) {
          nonceId = parsed;
        }
      }

      const { buildAssetCreation } = await import('../utils/buildAssetTx.js');
      const { payload, nonce } = await buildAssetCreation({
        privateKey: wallet.privateKey,
        name: nameInput,
        supply: supplyStr,
        decimals: decimalsInput,
        nonce: nonceId,
        pinHash,
        pinHeight,
        minFeeE8: await fetchMinFeeE8(),
      });

      const result = await query('createAsset', 'transaction/add', 'POST', payload);
      if (!isNodeSuccess(result)) {
        throw new Error(getNodeError(result) || 'Node rejected asset creation');
      }

      updateNonceAfterSuccess(nonce);

      if (isTestnetNode(selectedNode)) {
        await performFakeMine?.();
      }

      if (document.getElementById('createNonceOverride')) {
        document.getElementById('createNonceOverride').value = '';
      }

      toast.success('Asset creation transaction sent — check History tab');
      document.getElementById('assetName').value = '';
      document.getElementById('assetSupply').value = '';
    } catch (err) {
      console.error(err);
      const errorDetail = err.response?.data?.error || err.response?.data?.message || err.message;
      toast.error('Failed to create asset: ' + errorDetail);
    } finally {
      setLoading(prev => ({ ...prev, createAsset: false }));
    }
  };

  // ==================== TRANSFER ASSET ====================
  const handleTransferAsset = async () => {
    const assetIdRaw = document.getElementById('transferAssetId').value.trim();
    const recipientRaw = document.getElementById('transferRecipient').value.trim();
    const amountStr = document.getElementById('transferAmount').value.trim();
    const decimalsStr = document.getElementById('transferDecimals')?.value || '8';
    const decimals = parseInt(decimalsStr) || 8;
    const isLiquidityEl = document.getElementById('isLiquidity');
    const isLiquidity = isLiquidityEl ? isLiquidityEl.checked : false;

    const nonceOverrideRaw = document.getElementById('transferNonceOverride')?.value.trim();
    let nonceId = getSmartNonce();
    if (nonceOverrideRaw !== '') {
      const parsed = parseInt(nonceOverrideRaw);
      if (!isNaN(parsed)) {
        nonceId = parsed;
      }
    }

    if (!assetIdRaw || !recipientRaw || !amountStr) {
      toast.error('All transfer fields are required');
      return;
    }
    if (!wallet?.privateKey) {
      toast.error('Wallet not loaded. Please log in again.');
      return;
    }

    if (!isValidAssetHash(assetIdRaw)) {
      toast.error('Asset hash must be exactly 64 hex characters');
      return;
    }

    setLoading(prev => ({ ...prev, transferAsset: true }));

    try {
      const { buildAssetTransfer } = await import('../utils/buildAssetTx.js');
      const { payload, nonce } = await buildAssetTransfer({
        privateKey: wallet.privateKey,
        assetHash: assetIdRaw,
        toAddress: recipientRaw,
        amount: amountStr,
        decimals,
        isLiquidity,
        nonce: nonceId,
        pinHash,
        pinHeight,
        minFeeE8: await fetchMinFeeE8(),
      });

      const result = await query('transferAsset', 'transaction/add', 'POST', payload);
      if (!isNodeSuccess(result)) {
        throw new Error(getNodeError(result) || 'Node rejected asset transfer');
      }

      updateNonceAfterSuccess(nonce);

      if (isTestnetNode(selectedNode)) {
        await performFakeMine?.();
      }

      if (document.getElementById('transferNonceOverride')) {
        document.getElementById('transferNonceOverride').value = '';
      }

      toast.success('Asset transfer sent — check History tab');
    } catch (err) {
      console.error(err);
      toast.error('Transfer failed: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(prev => ({ ...prev, transferAsset: false }));
    }
  };

  const tabs = [
    { id: 'create', label: 'Create Asset' },
    { id: 'transfer', label: 'Transfer Asset' },
    { id: 'search', label: 'Search & Lookup' },
  ];

  return (
    <div className="space-y-8">
      <h2 className="text-3xl font-bold">Asset Tools</h2>
      <p className="mb-6 text-gray-600 dark:text-gray-400">
        Create, transfer, search, and look up assets on the DeFi testnet.
      </p>

      {/* SUB TABS - consistent with DexPage styling */}
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

      {/* CREATE ASSET TAB */}
      {activeTab === 'create' && (
        <section className="border-2 border-blue-500 rounded-3xl p-8 bg-blue-50 dark:bg-blue-950 shadow-xl">
          <h3 className="text-2xl font-bold mb-6 text-blue-700 dark:text-blue-300">Create New Asset</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-2xl transition-all"
              >
                {loading.createAsset ? 'Creating Asset...' : 'Create Asset'}
              </button>

              {results.createAsset && renderTransactionResult(results.createAsset, 'Asset Creation')}
            </div>
          </div>
        </section>
      )}

      {/* TRANSFER ASSET TAB */}
      {activeTab === 'transfer' && (
        <section className="border-2 border-cyan-500 rounded-3xl p-8 bg-cyan-50 dark:bg-cyan-950 shadow-xl">
          <h3 className="text-2xl font-bold mb-6 text-cyan-700 dark:text-cyan-300">Transfer Asset</h3>
          <p className="text-sm text-cyan-600 dark:text-cyan-400 mb-4">
            Smart nonce is used by default. Use the Nonce Override field only when you get "Duplicate nonce" errors.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">Asset Hash (64 hex chars, no 0x)</label>
              <input id="transferAssetId" placeholder="e.g. b92b88491b478c22fbc5b3f03f8b5539555ff2680944a8c847a1eb90ef69894e" className="input mb-3" />

              <label className="block text-sm font-medium mb-2">Decimals / Precision</label>
              <input id="transferDecimals" type="number" defaultValue="8" className="input mb-1" />

              <div className="flex items-center mb-3">
                <input type="checkbox" id="isLiquidity" className="mr-2 h-4 w-4 accent-blue-600" />
                <label htmlFor="isLiquidity" className="text-sm font-medium text-gray-300">This is a Liquidity Token (force precision 8)</label>
              </div>

              <label className="block text-sm font-medium mb-2">Recipient Address</label>
              <input id="transferRecipient" placeholder="recipient address (no 0x)" className="input mb-3" />

              <label className="block text-sm font-medium mb-2">Amount (in token units)</label>
              <input id="transferAmount" type="number" step="any" placeholder="e.g. 1.5" className="input mb-3" />

              <label className="block text-sm font-medium mb-2 text-amber-400">
                Nonce Override (only use if you get "Duplicate nonce")
              </label>
              <input 
                id="transferNonceOverride" 
                type="number" 
                placeholder="Leave empty for auto" 
                className="input mb-6" 
              />

              <button
                onClick={handleTransferAsset}
                disabled={loading.transferAsset}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-2xl transition-all"
              >
                {loading.transferAsset ? 'Transferring...' : 'Transfer Asset'}
              </button>

              {results.transferAsset && renderTransactionResult(results.transferAsset, 'Asset Transfer')}
            </div>
          </div>
        </section>
      )}

      {/* SEARCH & LOOKUP TAB */}
      {activeTab === 'search' && (
        <section className="border-2 border-violet-500 rounded-3xl p-8 bg-violet-50 dark:bg-violet-950 shadow-xl">
          <h3 className="text-2xl font-bold mb-6 text-violet-700 dark:text-violet-300">Asset Search & Lookup</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <label className="block text-sm font-medium mb-2">Asset Complete (by name)</label>
              <input id="namePrefix" placeholder="namePrefix" className="input mb-3" />
              <input id="hashPrefix" placeholder="hashPrefix (optional)" className="input mb-4" />
              <button
                onClick={() => {
                  const name = document.getElementById('namePrefix').value;
                  const hash = document.getElementById('hashPrefix').value;
                  let path = `asset/complete?namePrefix=${encodeURIComponent(name)}`;
                  if (hash) path += `&hashPrefix=${encodeURIComponent(hash)}`;
                  query('assetComplete', path);
                }}
                disabled={loading.assetComplete}
                className="px-6 py-3 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-2xl transition-colors"
              >
                {loading.assetComplete ? 'Querying...' : 'Query'}
              </button>

              {results.assetComplete && results.assetComplete.code === 0 && results.assetComplete.data?.matches?.length > 0 && (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-3 px-1">
                    <div className="text-sm text-zinc-400">
                      Found <span className="font-semibold text-white">{results.assetComplete.data.matches.length}</span> match{results.assetComplete.data.matches.length !== 1 ? 'es' : ''} for “{results.assetComplete.data.namePrefix}”
                    </div>
                  </div>
                  <div className="space-y-3">
                    {results.assetComplete.data.matches.map((asset, idx) => (
                      <div key={idx}>{renderAssetCard(asset, true)}</div>
                    ))}
                  </div>
                </div>
              )}

              {results.assetComplete && results.assetComplete.code === 0 && results.assetComplete.data?.matches?.length === 0 && (
                <div className="mt-6 p-4 bg-zinc-950 border border-zinc-700 rounded-2xl text-center text-sm text-zinc-400">
                  No assets found matching your search.
                </div>
              )}

              {results.assetComplete && results.assetComplete.error && (
                <div className="mt-6 p-4 bg-red-950/40 border border-red-700 rounded-2xl text-sm text-red-400">
                  {results.assetComplete.error}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Lookup Asset (by hash)</label>
              <input id="assetLookup" placeholder="asset hash (64 hex)" className="input mb-4" />
              <button
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
                className="px-6 py-3 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-2xl transition-colors"
              >
                {loading.assetLookup ? 'Querying...' : 'Query'}
              </button>

              {results.assetLookup && results.assetLookup.code === 0 && results.assetLookup.data && (
                <div className="mt-6">
                  {renderAssetCard(results.assetLookup.data)}
                </div>
              )}

              {results.assetLookup && results.assetLookup.code === 0 && !results.assetLookup.data && (
                <div className="mt-6 p-4 bg-zinc-950 border border-zinc-700 rounded-2xl text-center text-sm text-zinc-400">
                  Asset not found.
                </div>
              )}

              {results.assetLookup && results.assetLookup.error && (
                <div className="mt-6 p-4 bg-red-950/40 border border-red-700 rounded-2xl text-sm text-red-400">
                  {results.assetLookup.error}
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

export default AssetPage;