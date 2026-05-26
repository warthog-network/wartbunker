import React, { useState } from 'react';
import axios from 'axios';
import { ethers } from 'ethers';
import { useWallet } from './WalletContext';

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

  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});

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

  // ==================== ENHANCED QUERY (supports POST) ====================
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
      alert('Asset Hash, Asset Amount, and WART Amount are required');
      return;
    }
    if (!wallet?.privateKey) {
      alert('Wallet not loaded. Please log in again.');
      return;
    }

    let assetHash = assetHashRaw;
    if (assetHash.toLowerCase().startsWith('0x')) assetHash = assetHash.slice(2);
    if (assetHash.length !== 64) {
      alert('Asset Hash must be exactly 64 hex characters (without 0x)');
      return;
    }

    const assetAmountFloat = parseFloat(assetAmountStr.replace(',', '.'));
    const decimals = parseInt(decimalsStr) || 8;
    if (!Number.isFinite(assetAmountFloat) || assetAmountFloat <= 0) {
      alert('Please enter a valid Asset Amount greater than 0');
      return;
    }
    const amountU64 = Math.floor(assetAmountFloat * Math.pow(10, decimals));

    const wartAmountFloat = parseFloat(wartAmountStr.replace(',', '.'));
    if (!Number.isFinite(wartAmountFloat) || wartAmountFloat < 0) {
      alert('Please enter a valid WART Amount');
      return;
    }
    const wartE8 = Math.floor(wartAmountFloat * 100000000);

    setLoading(prev => ({ ...prev, liquidityDeposit: true }));

    try {
      const currentPinHeight = pinHeight || 0;
      const currentPinHash = pinHash || '0000000000000000000000000000000000000000000000000000000000000000';

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

      alert('✅ Liquidity deposit sent successfully!\n\nAfter confirmation, scroll down to "Pool Info & My Liquidity Position" to verify.');
    } catch (err) {
      console.error(err);
      alert('Liquidity deposit failed: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(prev => ({ ...prev, liquidityDeposit: false }));
    }
  };

  // ==================== LOAD POOL INFO + MY LIQUIDITY POSITION ====================
  const loadPoolAndPosition = async () => {
    const assetRaw = document.getElementById('poolAssetHash')?.value.trim() || '';
    if (!assetRaw) {
      alert('Please enter an Asset Hash');
      return;
    }

    let assetHash = assetRaw;
    if (assetHash.toLowerCase().startsWith('0x')) assetHash = assetHash.slice(2);
    if (assetHash.length !== 64) {
      alert('Asset Hash must be exactly 64 hex characters');
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
      alert('Asset Hash, Amount, and Encoded Limit Price are required');
      return;
    }
    if (!wallet?.privateKey) {
      alert('Wallet not loaded. Please log in again.');
      return;
    }

    let assetHash = assetHashRaw;
    if (assetHash.toLowerCase().startsWith('0x')) assetHash = assetHash.slice(2);
    if (assetHash.length !== 64) {
      alert('Asset Hash must be exactly 64 hex characters (without 0x)');
      return;
    }
    if (limitHex.length !== 6) {
      alert('Limit price must be exactly 6 hex characters (3 bytes)');
      return;
    }

    const amountU64 = Math.floor(parseFloat(amountStr) * 100000000);

    setLoading(prev => ({ ...prev, limitSwap: true }));

    try {
      const currentPinHeight = pinHeight || 0;
      const currentPinHash = pinHash || '0000000000000000000000000000000000000000000000000000000000000000';

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

      alert('✅ Limit order submitted successfully!');
    } catch (err) {
      console.error(err);
      alert('Limit order failed: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(prev => ({ ...prev, limitSwap: false }));
    }
  };

  // ==================== FIXED PRICE ENCODER ====================
  const encodeLimitPrice = async () => {
    const priceStr = document.getElementById('limitPriceHuman')?.value.trim();
    const decimalsStr = document.getElementById('limitPriceDecimals')?.value.trim() || '8';

    if (!priceStr) {
      alert('Please enter a price');
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
        alert(`✅ Encoded limit: ${encoded}`);
      } else {
        alert("Could not extract encoded limit. Check browser console for the response structure.");
        console.warn("Unexpected response format:", res.data);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to encode price: ' + (err.response?.data?.message || err.message));
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
            {results.dexMarket && (
              <pre className="result mt-6">{JSON.stringify(results.dexMarket, null, 2)}</pre>
            )}
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
            {results.openOrders && (
              <pre className="result mt-4">{JSON.stringify(results.openOrders, null, 2)}</pre>
            )}
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
              <pre className="result mt-4">{JSON.stringify(results.mempool, null, 2)}</pre>
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

            {results.liquidityDeposit && (
              <pre className="result mt-6 text-sm overflow-auto max-h-64">
                {JSON.stringify(results.liquidityDeposit, null, 2)}
              </pre>
            )}
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

        {results.poolMarket && (
          <div className="mb-8">
            <h4 className="font-semibold text-emerald-400 mb-2 flex items-center gap-2">
              Pool / Market Details <span className="text-xs bg-emerald-900 px-2 py-0.5 rounded">/dex/market</span>
            </h4>
            <pre className="result text-sm overflow-auto max-h-96 border border-emerald-800">
              {JSON.stringify(results.poolMarket, null, 2)}
            </pre>
          </div>
        )}

        {results.myAssetBalance && (
          <div>
            <h4 className="font-semibold text-emerald-400 mb-2 flex items-center gap-2">
              Your Balance in this Asset / LP Position <span className="text-xs bg-emerald-900 px-2 py-0.5 rounded">/account/.../balance</span>
            </h4>
            <pre className="result text-sm overflow-auto max-h-96 border border-emerald-800">
              {JSON.stringify(results.myAssetBalance, null, 2)}
            </pre>
            <p className="text-xs text-emerald-500 mt-2">
              This shows your current holding. Successful liquidity deposits will increase your position here once confirmed.
            </p>
          </div>
        )}

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

            {/* ==================== IMPROVED PRICE ENCODER ==================== */}
            <div className="bg-zinc-900 border border-violet-700 p-4 rounded-2xl mb-4">
              <div className="text-sm font-medium text-violet-300 mb-3">
                Quick Limit Price Encoder
              </div>

              <div className="flex flex-col md:flex-row gap-3 items-end">
                {/* Price Input */}
                <div className="flex-1">
                  <label className="text-xs text-gray-400 block mb-1.5">Price</label>
                  <input
                    id="limitPriceHuman"
                    type="text"
                    placeholder="e.g. 0.0005"
                    className="w-full bg-black border border-zinc-700 focus:border-violet-500 text-white px-4 py-3 rounded-xl outline-none"
                  />
                </div>

                {/* Decimals Input */}
                <div className="w-full md:w-28">
                  <label className="text-xs text-gray-400 block mb-1.5">Decimals</label>
                  <input
                    id="limitPriceDecimals"
                    type="number"
                    defaultValue="8"
                    className="w-full bg-black border border-zinc-700 focus:border-violet-500 text-white px-4 py-3 rounded-xl outline-none"
                  />
                </div>

                {/* Encode Button */}
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

            {results.limitSwap && (
              <pre className="result mt-6 text-sm overflow-auto max-h-64">
                {JSON.stringify(results.limitSwap, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </section>
    </>
  );
};

export default DexPage;