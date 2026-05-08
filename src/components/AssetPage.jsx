import React, { useState } from 'react';
import axios from 'axios';
import { ethers } from 'ethers';
import { useWallet } from './WalletContext';

const API_URL = '/api/proxy';

const AssetPage = ({ selectedNode, wallet: propWallet }) => {
  const { nextNonce, pinHeight } = useWallet();

  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});

  const wallet = propWallet || (sessionStorage.getItem('warthogWalletDecrypted')
    ? JSON.parse(sessionStorage.getItem('warthogWalletDecrypted'))
    : null);

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
      const nonceId = nextNonce !== null && nextNonce !== undefined ? nextNonce : 0;
      const supplyU64 = Math.floor(parseFloat(supplyStr) * Math.pow(10, decimals));
      const feeE8 = 1000000; // 0.01 WART

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

      // Remove "0x" prefix if present (some nodes expect clean 65-byte hex)
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
    const assetId = document.getElementById('transferAssetId').value.trim();
    const recipient = document.getElementById('transferRecipient').value.trim();
    const amountStr = document.getElementById('transferAmount').value;

    if (!assetId || !recipient || !amountStr) {
      alert('All transfer fields are required');
      return;
    }
    if (!wallet?.privateKey) {
      alert('Wallet not loaded. Please log in again.');
      return;
    }

    setLoading(prev => ({ ...prev, transferAsset: true }));

    try {
      const nonceId = nextNonce !== null && nextNonce !== undefined ? nextNonce : 0;
      const feeE8 = 1000000;

      const txData = {
        type: "assetTransfer",
        asset: assetId,
        to: recipient,
        amount: parseFloat(amountStr),
        pinHeight: pinHeight || 0,
        nonceId: nonceId,
        feeE8: feeE8,
      };

      const walletSigner = new ethers.Wallet(wallet.privateKey);
      const message = JSON.stringify(txData);
      let signature = await walletSigner.signMessage(message);
      if (signature.startsWith('0x')) signature = signature.slice(2);

      const signedTx = { ...txData, signature65: signature };

      await query('transferAsset', 'transaction/add', 'POST', signedTx);

      alert('✅ Asset transfer transaction sent successfully!');
    } catch (err) {
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">Asset ID</label>
            <input id="transferAssetId" placeholder="asset identifier" className="input mb-3" />

            <label className="block text-sm font-medium mb-2">Recipient Address</label>
            <input id="transferRecipient" placeholder="recipient address" className="input mb-3" />

            <label className="block text-sm font-medium mb-2">Amount</label>
            <input id="transferAmount" type="number" placeholder="amount to transfer" className="input mb-6" />

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
            <label className="block text-sm font-medium mb-2">Asset Complete</label>
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
            <label className="block text-sm font-medium mb-2">Lookup Asset</label>
            <input id="assetLookup" placeholder="asset identifier" className="input mb-4" />
            <button
              onClick={() => query('assetLookup', `asset/lookup/${encodeURIComponent(document.getElementById('assetLookup').value)}`)}
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