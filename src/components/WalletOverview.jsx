import React, { useState } from 'react';
import { useWallet } from './WalletContext';
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
  } = useWallet();

  const [manualAssetHash, setManualAssetHash] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [isMining, setIsMining] = useState(false);

  // NEW: Open Limit Orders state
  const [openOrders, setOpenOrders] = useState(null);
  const [loadingOpenOrders, setLoadingOpenOrders] = useState(false);

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      alert('Copied to clipboard!');
    }).catch(err => console.error('Failed to copy:', err));
  };

  const handleFetchManualAsset = async () => {
    if (!manualAssetHash || manualAssetHash.length < 60) {
      alert('Please enter a valid asset hash (64 characters)');
      return;
    }

    setIsFetching(true);
    try {
      await fetchAssetBalance(manualAssetHash);
      setManualAssetHash('');
    } catch (err) {
      alert('Failed to fetch asset balance');
    }
    setIsFetching(false);
  };

  // ==================== FETCH OPEN LIMIT ORDERS ====================
  const fetchOpenOrders = async () => {
    if (!wallet?.address) {
      alert('No wallet connected');
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
      alert('Failed to fetch open orders: ' + (err.response?.data?.message || err.message));
    }
    setLoadingOpenOrders(false);
  };
  // ============================================================

  // ==================== IMPROVED FAKE MINE ====================
  const handleFakeMine = async () => {
    if (!wallet?.address) {
      alert('No wallet connected');
      return;
    }

    const confirmMine = window.confirm(
      `Fake mine to this address on testnet?\n\n${wallet.address}`
    );
    if (!confirmMine) return;

    setIsMining(true);

    try {
      await axios.get(
        `https://warthog-defitestnet.duckdns.org/debug/fakemine/${wallet.address}`
      );
    } catch (err) {
      console.log("Fake mine request finished");
    }

    setTimeout(() => {
      refreshBalance();
      setIsMining(false);
      alert("✅ Balance refreshed. Check if fake mining worked.");
    }, 2000);
  };
  // ========================================================

  if (!wallet) {
    return <div>Please log in to view your wallet.</div>;
  }

  return (
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

      {/* Your Assets Section */}
      {assetBalances.length > 0 && (
        <div className="result mt-4" style={{ textAlign: 'left' }}>
          <p className="font-semibold mb-3 text-blue-400">Your Assets</p>
          {assetBalances.map((asset, index) => (
            <div 
              key={index} 
              className="flex justify-between items-center py-2 border-t border-zinc-800 first:border-t-0"
            >
              <div>
                <span className="font-medium">{asset.name}</span>
                <span className="text-xs text-gray-500 ml-2">({asset.hash.slice(0, 10)}...)</span>
              </div>
              <div className="font-mono text-right">
                {asset.balance} <span className="text-xs text-gray-400">{asset.name}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* === MANUAL ASSET FETCH SECTION === */}
      <div className="result mt-4" style={{ textAlign: 'left' }}>
        <p className="font-semibold mb-2 text-orange-400">Fetch Asset Balance</p>
        
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Paste asset hash here (64 hex characters)"
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
        
        <p className="text-xs text-gray-500 mt-1">
          Paste the asset hash from the creation response to manually add it here.
        </p>
      </div>

      {/* ==================== NEW: OPEN LIMIT ORDERS ==================== */}
      <div className="result mt-4" style={{ textAlign: 'left' }}>
        <p className="font-semibold mb-2 text-purple-400">My Open Limit Orders</p>
        
        <button
          onClick={fetchOpenOrders}
          disabled={loadingOpenOrders}
          className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-2xl disabled:opacity-60 transition-all mb-3"
        >
          {loadingOpenOrders ? 'Loading Open Orders...' : 'View My Open Limit Orders'}
        </button>

        {openOrders && (
          <div>
            <p className="text-xs text-gray-400 mb-2">
              Showing pending limit orders for this wallet
            </p>
            <pre className="result text-sm overflow-auto max-h-96 bg-zinc-950 border border-zinc-800">
              {JSON.stringify(openOrders, null, 2)}
            </pre>
          </div>
        )}

        {!openOrders && (
          <p className="text-xs text-gray-500">
            Click the button above to see your pending buy/sell limit orders.
          </p>
        )}
      </div>
      {/* ============================================================ */}

      {/* ==================== FAKE MINE BUTTON ==================== */}
      <div className="result mt-4" style={{ textAlign: 'left' }}>
        <p className="font-semibold mb-2 text-emerald-400">Testnet Tools</p>
        <button
          onClick={handleFakeMine}
          disabled={isMining}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-2xl disabled:opacity-60 transition-all"
        >
          {isMining ? 'Mining...' : '⛏️ Fake Mine (Add Test Balance)'}
        </button>
        <p className="text-xs text-gray-500 mt-1">
          Only works on DeFi testnet. Use for testing.
        </p>
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
  );
};

export default WalletOverview;