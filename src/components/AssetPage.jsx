import React, { useState } from 'react';
import axios from 'axios';
import { ethers } from 'ethers';
import { useWallet } from './WalletContext';

const API_URL = '/api/proxy';

const AssetPage = ({ selectedNode, wallet: propWallet }) => {
  const { nextNonce, pinHeight, pinHash } = useWallet();

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

  // ====================== BINARY HELPERS ======================
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

// ==================== CREATE ASSET (Fixed - try this version) ====================
const handleCreateAsset = async () => {
  const nameInput = document.getElementById('assetName').value.trim().toUpperCase();
  const supplyStr = document.getElementById('assetSupply').value.trim();
  const decimalsInput = parseInt(document.getElementById('assetDecimals').value) || 8;

  if (!nameInput || nameInput.length < 1 || nameInput.length > 5) {
    alert('Asset name must be 1-5 uppercase characters (e.g. HOG)');
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
    const name = nameInput;
    const decimals = Math.min(Math.max(decimalsInput, 0), 18);
    const supplyFloat = parseFloat(supplyStr);
    const supplyU64 = BigInt(Math.floor(supplyFloat * Math.pow(10, decimals)));

    const nonceId = nextNonce !== null && nextNonce !== undefined ? nextNonce : 0;
    const currentPinHeight = pinHeight || 0;
    const currentPinHash = pinHash || '0000000000000000000000000000000000000000000000000000000000000000';

    const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;

    // === FETCH MINIMUM FEE FROM NODE (critical for "Inexact fee" error) ===
    const minFeeRes = await axios.get(
      `${API_URL}?nodePath=transaction/minfee&${nodeBaseParam}`
    );
    const minFeeE8 = minFeeRes.data?.data?.minFee?.E8 || minFeeRes.data?.minFee?.E8;

    if (!minFeeE8) {
      throw new Error('Could not fetch minimum fee');
    }
    console.log('Using exact minFeeE8 from node:', minFeeE8);

    // === BINARY ===
    const pinHashBytes = hexToBytes(currentPinHash.replace('0x', ''));
    const nameBytes = new Uint8Array(5);
    nameBytes.set(new TextEncoder().encode(name));

    const binaryParts = [
      pinHashBytes,
      uint32BE(currentPinHeight),
      uint32BE(nonceId),
      new Uint8Array(3),
      uint64BE(BigInt(minFeeE8)),
      uint64BE(supplyU64),
      new Uint8Array([decimals]),
      nameBytes
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

    console.log('=== ASSET CREATION ===');
    console.log('Name:', name, 'Decimals:', decimals, 'SupplyU64:', supplyU64.toString());
    console.log('Hash:', hash);

    const signer = new ethers.Wallet(wallet.privateKey);
    const signature = await signer.signingKey.sign(ethers.getBytes('0x' + hash));

    const r = signature.r.slice(2).padStart(64, '0');
    const s = signature.s.slice(2).padStart(64, '0');
    const v = (signature.v - 27).toString(16).padStart(2, '0');
    const signature65 = r + s + v;

    // === PAYLOAD - Use "decimals" field name + exact fee ===
    const payload = {
      type: "assetCreation",
      name: name,
      decimals: decimals,                    // ← field name that got us further
      supplyU64: Number(supplyU64),
      feeE8: Number(minFeeE8),               // ← exact fee from node
      nonceId: nonceId,
      pinHeight: currentPinHeight,
      signature65: signature65,
    };

    const response = await axios.post(
      `${API_URL}?nodePath=transaction/add&${nodeBaseParam}`,
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (response.data.code === 0 || response.data.success || response.data.txHash) {
      const txHash = response.data.txHash || response.data.data?.txHash || 'Pending';
      alert(`✅ Asset "${name}" creation sent successfully!\nTx Hash: ${txHash}`);
      document.getElementById('assetName').value = '';
      document.getElementById('assetSupply').value = '';
    } else {
      throw new Error(response.data.error || response.data.message || 'Rejected by node');
    }
  } catch (err) {
    console.error(err);
    alert('Failed to create asset: ' + (err.response?.data?.error || err.message));
  } finally {
    setLoading(prev => ({ ...prev, createAsset: false }));
  }
};
  // ==================== CANCEL TRANSACTION (New - matches docs) ====================
  const handleCancelTransaction = async () => {
    const cancelHeightStr = document.getElementById('cancelHeight').value.trim();
    const cancelNonceIdStr = document.getElementById('cancelNonceId').value.trim();

    if (!cancelHeightStr || !cancelNonceIdStr) {
      alert('Cancel Height and Cancel Nonce ID are required');
      return;
    }

    const cancelHeight = parseInt(cancelHeightStr);
    const cancelNonceId = parseInt(cancelNonceIdStr);

    if (!wallet?.privateKey) {
      alert('Wallet not loaded. Please log in again.');
      return;
    }

    setLoading(prev => ({ ...prev, cancel: true }));

    try {
      const nonceId = nextNonce !== null && nextNonce !== undefined ? nextNonce : 0;
      const currentPinHeight = pinHeight || 0;
      const currentPinHash = pinHash || '0000000000000000000000000000000000000000000000000000000000000000';
      const feeStr = "0.0001";

      const pinHashBytes = hexToBytes(currentPinHash.replace('0x', ''));

      // === BINARY LAYOUT FOR cancelation (matches documentation) ===
      const binaryParts = [
        pinHashBytes,                    // 32 bytes
        uint32BE(currentPinHeight),      // 4 bytes
        uint32BE(nonceId),               // 4 bytes
        new Uint8Array(3),               // 3 bytes reserved
        uint64BE(10000),                 // 8 bytes feeE8 (0.0001 WART)
        uint32BE(cancelHeight),          // 4 bytes cancelHeight
        uint32BE(cancelNonceId)          // 4 bytes cancelNonceId
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

      // === PAYLOAD (matches documentation) ===
      const payload = {
        type: "cancelation",
        cancelHeight: cancelHeight,
        cancelNonceId: cancelNonceId,
        feeStr: feeStr,
        nonceId: nonceId,
        pinHeight: currentPinHeight,
        signature65: signature65,
      };

      const response = await axios.post(
        `${API_URL}?nodePath=transaction/add&nodeBase=${encodeURIComponent(selectedNode)}`,
        payload,
        { headers: { 'Content-Type': 'application/json' } }
      );

      if (response.data.code === 0 || response.data.success || response.data.txHash) {
        const txHash = response.data.txHash || response.data.data?.txHash || 'Pending';
        alert(`✅ Cancel transaction sent successfully!\n\nCanceling Height: ${cancelHeight}, Nonce: ${cancelNonceId}\nTx Hash: ${txHash}`);
        
        document.getElementById('cancelHeight').value = '';
        document.getElementById('cancelNonceId').value = '';
      } else {
        throw new Error(response.data.error || response.data.message || 'Cancel rejected');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to cancel transaction: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(prev => ({ ...prev, cancel: false }));
    }
  };

  // ==================== TRANSFER ASSET (Updated payload style) ====================
  const handleTransferAsset = async () => {
    const assetId = document.getElementById('transferAssetId').value.trim();
    const recipient = document.getElementById('transferRecipient').value.trim();
    const amountStr = document.getElementById('transferAmount').value.trim();

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
      const currentPinHeight = pinHeight || 0;
      const currentPinHash = pinHash || '0000000000000000000000000000000000000000000000000000000000000000';
      const feeStr = "0.01"; // Consistent with docs style

      const amountFloat = parseFloat(amountStr);
      // Note: For production, fetch asset decimals. Using 8 as default for now.
      const amountU64 = BigInt(Math.floor(amountFloat * Math.pow(10, 8)));

      const pinHashBytes = hexToBytes(currentPinHash.replace('0x', ''));

      // Binary layout kept similar to original (update when full transfer spec is available)
      const binaryParts = [
        pinHashBytes,
        uint32BE(currentPinHeight),
        uint32BE(nonceId),
        new Uint8Array(3),
        uint64BE(1000000), // feeE8 for signing
        hexToBytes(recipient.replace('0x', '').padEnd(40, '0').slice(0, 40)),
        uint64BE(amountU64),
        new Uint8Array(32) // asset placeholder (update with real asset hash when spec available)
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

      // === PAYLOAD (updated to feeStr style) ===
      const payload = {
        type: "tokenTransfer",
        asset: assetId,
        to: recipient,
        amount: Number(amountU64),
        pinHeight: currentPinHeight,
        nonceId: nonceId,
        feeStr: feeStr,
        signature65: signature65,
      };

      const response = await axios.post(
        `${API_URL}?nodePath=transaction/add&nodeBase=${encodeURIComponent(selectedNode)}`,
        payload,
        { headers: { 'Content-Type': 'application/json' } }
      );

      if (response.data.code === 0 || response.data.success || response.data.txHash) {
        const txHash = response.data.txHash || response.data.data?.txHash || 'Pending';
        alert(`✅ Asset transfer sent successfully!\n\nAsset: ${assetId}\nTo: ${recipient}\nAmount: ${amountStr}\nTx Hash: ${txHash}`);
      } else {
        throw new Error(response.data.error || response.data.message || 'Transfer rejected');
      }
    } catch (err) {
      console.error(err);
      alert('Transfer failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(prev => ({ ...prev, transferAsset: false }));
    }
  };

  return (
    <div className="space-y-8">
      <h2 className="text-3xl font-bold">Asset Tools</h2>
      <p className="mb-6 text-gray-600 dark:text-gray-400">
        Create, transfer, cancel, search, and look up assets on the DeFi testnet.
      </p>

      {/* CREATE ASSET */}
      <div className="rounded-3xl p-8 shadow-xl bg-zinc-900">
        <h3 className="text-2xl font-bold mb-6 text-blue-400">Create New Asset</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">Asset Name (1-5 chars)</label>
            <input id="assetName" maxLength="5" placeholder="e.g. HOG" className="input mb-4" />

            <label className="block text-sm font-medium mb-2">Total Supply</label>
            <input id="assetSupply" type="number" placeholder="1000000" className="input mb-4" />

            <label className="block text-sm font-medium mb-2">Decimals</label>
            <input id="assetDecimals" type="number" defaultValue="8" className="input mb-6" />

            <button
              onClick={handleCreateAsset}
              disabled={loading.createAsset}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-2xl transition-all"
            >
              {loading.createAsset ? 'Creating Asset...' : 'Create Asset'}
            </button>
          </div>
        </div>
      </div>

      {/* CANCEL TRANSACTION */}
      <div className="rounded-3xl p-8 shadow-xl bg-zinc-900">
        <h3 className="text-2xl font-bold mb-6 text-red-400">Cancel Transaction</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">Cancel Height</label>
            <input id="cancelHeight" type="number" placeholder="e.g. 1198900" className="input mb-3" />

            <label className="block text-sm font-medium mb-2">Cancel Nonce ID</label>
            <input id="cancelNonceId" type="number" placeholder="e.g. 5" className="input mb-6" />

            <button
              onClick={handleCancelTransaction}
              disabled={loading.cancel}
              className="w-full py-4 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-2xl transition-all"
            >
              {loading.cancel ? 'Canceling...' : 'Cancel Transaction'}
            </button>
          </div>
        </div>
      </div>

      {/* TRANSFER ASSET */}
      <div className="rounded-3xl p-8 shadow-xl bg-zinc-900">
        <h3 className="text-2xl font-bold mb-6 text-blue-400">Transfer Asset</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">Asset ID / Name</label>
            <input id="transferAssetId" placeholder="e.g. HOG or asset hash" className="input mb-3" />

            <label className="block text-sm font-medium mb-2">Recipient Address</label>
            <input id="transferRecipient" placeholder="0x... recipient address" className="input mb-3" />

            <label className="block text-sm font-medium mb-2">Amount</label>
            <input id="transferAmount" type="number" step="any" placeholder="amount to transfer" className="input mb-6" />

            <button
              onClick={handleTransferAsset}
              disabled={loading.transferAsset}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-2xl transition-all"
            >
              {loading.transferAsset ? 'Transferring...' : 'Transfer Asset'}
            </button>
          </div>
        </div>
      </div>

      {/* SEARCH & LOOKUP */}
      <div className="rounded-3xl p-8 shadow-xl bg-zinc-900">
        <h3 className="text-2xl font-bold mb-6 text-blue-400">Asset Search & Lookup</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <label className="block text-sm font-medium mb-2">Asset Complete (by name/hash prefix)</label>
            <input id="namePrefix" placeholder="namePrefix (e.g. HOG)" className="input mb-3" />
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
              {loading.assetComplete ? 'Querying...' : 'Query Asset Complete'}
            </button>
            {results.assetComplete && (
              <pre className="result mt-6 text-sm overflow-auto max-h-64 bg-zinc-950 p-4 rounded-xl">
                {JSON.stringify(results.assetComplete, null, 2)}
              </pre>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Lookup Asset</label>
            <input id="assetLookup" placeholder="asset identifier (name or hash)" className="input mb-4" />
            <button
              onClick={() => query('assetLookup', `asset/lookup/${encodeURIComponent(document.getElementById('assetLookup').value)}`)}
              disabled={loading.assetLookup}
              className="px-6 py-3 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-2xl transition-colors"
            >
              {loading.assetLookup ? 'Querying...' : 'Lookup Asset'}
            </button>
            {results.assetLookup && (
              <pre className="result mt-6 text-sm overflow-auto max-h-64 bg-zinc-950 p-4 rounded-xl">
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