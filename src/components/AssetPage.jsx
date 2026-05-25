import React, { useState } from 'react';
import axios from 'axios';
import { ethers } from 'ethers';
import { useWallet } from './WalletContext';

const API_URL = '/api/proxy';

const AssetPage = ({ selectedNode: propSelectedNode, wallet: propWallet }) => {
  const {
    nextNonce: contextNextNonce,
    pinHeight,
    pinHash,
    selectedNode: contextSelectedNode,
  } = useWallet();

  const selectedNode = propSelectedNode || contextSelectedNode || 'https://warthognode.duckdns.org';

  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});

  const wallet = propWallet || (sessionStorage.getItem('warthogWalletDecrypted')
    ? JSON.parse(sessionStorage.getItem('warthogWalletDecrypted'))
    : null);

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

  const addressToBytes = (addr) => {
    const clean = addr.startsWith('0x') ? addr.slice(2) : addr;
    return hexToBytes(clean.slice(0, 40));
  };

  // ==================== CREATE ASSET ====================
  const handleCreateAsset = async () => {
    const name = document.getElementById('assetName').value.trim().toUpperCase();
    const supplyStr = document.getElementById('assetSupply').value;
    const decimals = parseInt(document.getElementById('assetDecimals').value) || 8;

    if (!name || name.length < 1 || name.length > 5) {
      alert('Asset name must be 1-5 uppercase characters (e.g. LIQ)');
      return;
    }
    if (!supplyStr || parseFloat(supplyStr) <= 0) {
      alert('Please enter a valid total supply greater than 0');
      return;
    }
    if (!wallet?.privateKey) {
      alert('Wallet not loaded. Please log in again.');
      return;
    }

    setLoading(prev => ({ ...prev, createAsset: true }));

    try {
      const nonceId = getSmartNonce();
      const supplyU64 = Math.floor(parseFloat(supplyStr) * Math.pow(10, decimals));
      const feeE8 = 1000000;

      const txData = {
        type: "assetCreation",
        name: name,
        precision: decimals,
        supplyU64: supplyU64,
        pinHeight: pinHeight || 0,
        nonceId: nonceId,
        feeE8: feeE8,
      };

      const walletSigner = new ethers.Wallet(wallet.privateKey);
      const message = JSON.stringify(txData);
      let signature = await walletSigner.signMessage(message);
      if (signature.startsWith('0x')) signature = signature.slice(2);

      const signedTx = { ...txData, signature65: signature };

      await query('createAsset', 'transaction/add', 'POST', signedTx);

      alert('✅ Asset creation transaction sent successfully!\n\nCheck History tab soon.');
      document.getElementById('assetName').value = '';
      document.getElementById('assetSupply').value = '';
    } catch (err) {
      console.error(err);
      alert('Failed to create asset: ' + (err.message || 'Unknown error'));
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

    // NEW: Manual nonce override
    const nonceOverrideRaw = document.getElementById('transferNonceOverride')?.value.trim();
    let nonceId = getSmartNonce();
    if (nonceOverrideRaw !== '') {
      const parsed = parseInt(nonceOverrideRaw);
      if (!isNaN(parsed)) {
        nonceId = parsed;
      }
    }

    if (!assetIdRaw || !recipientRaw || !amountStr) {
      alert('All transfer fields are required');
      return;
    }
    if (!wallet?.privateKey) {
      alert('Wallet not loaded. Please log in again.');
      return;
    }

    let assetHash = assetIdRaw;
    if (assetHash.toLowerCase().startsWith('0x')) assetHash = assetHash.slice(2);
    let toAddr = recipientRaw;
    if (toAddr.toLowerCase().startsWith('0x')) toAddr = toAddr.slice(2);

    if (assetHash.length !== 64) {
      alert('Asset Hash must be exactly 64 hex characters (without 0x)');
      return;
    }

    const amountFloat = parseFloat(amountStr.replace(',', '.'));
    if (!Number.isFinite(amountFloat) || amountFloat <= 0) {
      alert('Please enter a valid amount greater than 0');
      return;
    }

    setLoading(prev => ({ ...prev, transferAsset: true }));

    try {
      const currentPinHeight = pinHeight || 0;
      const currentPinHash = pinHash || '0000000000000000000000000000000000000000000000000000000000000000';

      const effectiveDecimals = isLiquidity ? 8 : decimals;
      const amountU64 = Math.floor(amountFloat * Math.pow(10, effectiveDecimals));

      const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;

      // Get current minimum fee
      const minFeeRes = await axios.get(`${API_URL}?nodePath=transaction/minfee&${nodeBaseParam}`);
      const minFeeE8 = minFeeRes.data?.data?.minFee?.E8 || minFeeRes.data?.minFee?.E8 || 10000;

      // Build binary preimage
      const binaryParts = [
        hexToBytes(currentPinHash),
        uint32BE(currentPinHeight),
        uint32BE(nonceId),
        new Uint8Array(3),
        uint64BE(BigInt(minFeeE8)),
        hexToBytes(assetHash),
        new Uint8Array([isLiquidity ? 1 : 0]),
        addressToBytes(toAddr),
        uint64BE(BigInt(amountU64)),
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
        type: "tokenTransfer",
        assetHash: assetHash,
        isLiquidity: isLiquidity,
        toAddr: toAddr,
        amountU64: amountU64,
        feeE8: Number(minFeeE8),
        pinHeight: currentPinHeight,
        nonceId: nonceId,
        signature65: signature65,
      };

      console.log('=== TOKEN TRANSFER PAYLOAD ===', payload);

      await query('transferAsset', 'transaction/add', 'POST', payload);

      // Optimistic nonce update
      updateNonceAfterSuccess(nonceId);

      // Clear the override field after success
      if (document.getElementById('transferNonceOverride')) {
        document.getElementById('transferNonceOverride').value = '';
      }

      alert('✅ Asset transfer transaction sent successfully!\n\nCheck History tab soon.');
    } catch (err) {
      console.error(err);
      alert('Transfer failed: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(prev => ({ ...prev, transferAsset: false }));
    }
  };

  return (
    <div className="space-y-8">
      <h2 className="text-3xl font-bold">Asset Tools</h2>
      <p className="mb-6 text-gray-600 dark:text-gray-400">
        Create, transfer, search, and look up assets on the DeFi testnet.
      </p>

      {/* CREATE ASSET */}
      <div className="rounded-3xl p-8 shadow-xl bg-zinc-900">
        <h3 className="text-2xl font-bold mb-6 text-blue-400">Create New Asset</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">Asset Name (1-5 chars)</label>
            <input id="assetName" maxLength="5" placeholder="e.g. LIQ" className="input mb-4" />

            <label className="block text-sm font-medium mb-2">Total Supply</label>
            <input id="assetSupply" type="number" placeholder="1000000000" className="input mb-4" />

            <label className="block text-sm font-medium mb-2">Decimals</label>
            <input id="assetDecimals" type="number" defaultValue="8" className="input mb-6" />

            <button
              onClick={handleCreateAsset}
              disabled={loading.createAsset}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-2xl transition-all"
            >
              {loading.createAsset ? 'Creating Asset...' : 'Create Asset'}
            </button>

            {results.createAsset && (
              <pre className="result mt-6 text-sm overflow-auto max-h-64">
                {JSON.stringify(results.createAsset, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>

      {/* TRANSFER ASSET */}
      <div className="rounded-3xl p-8 shadow-xl bg-zinc-900">
        <h3 className="text-2xl font-bold mb-6 text-blue-400">Transfer Asset</h3>
        <p className="text-sm text-gray-400 mb-4">
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

            {/* NEW: Manual Nonce Override */}
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

            {results.transferAsset && (
              <pre className="result mt-6 text-sm overflow-auto max-h-64">
                {JSON.stringify(results.transferAsset, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>

      {/* SEARCH & LOOKUP */}
      <div className="rounded-3xl p-8 shadow-xl bg-zinc-900">
        <h3 className="text-2xl font-bold mb-6 text-blue-400">Asset Search & Lookup</h3>
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
            {results.assetComplete && (
              <pre className="result mt-6 text-sm overflow-auto max-h-64">
                {JSON.stringify(results.assetComplete, null, 2)}
              </pre>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Lookup Asset (by hash)</label>
            <input id="assetLookup" placeholder="asset hash (64 hex)" className="input mb-4" />
            <button
              onClick={() => {
                const val = document.getElementById('assetLookup').value.trim();
                const clean = val.startsWith('0x') ? val.slice(2) : val;
                query('assetLookup', `asset/lookup/${encodeURIComponent(clean)}`);
              }}
              disabled={loading.assetLookup}
              className="px-6 py-3 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-2xl transition-colors"
            >
              {loading.assetLookup ? 'Querying...' : 'Query'}
            </button>
            {results.assetLookup && (
              <pre className="result mt-6 text-sm overflow-auto max-h-64">
                {JSON.stringify(results.assetLookup, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssetPage;