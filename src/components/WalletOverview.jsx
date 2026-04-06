import React from 'react';
import { useWallet } from './WalletContext';

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
  } = useWallet();

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      alert('Copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy: ', err);
    });
  };

  if (!wallet) {
    return <div>Please log in to view your wallet.</div>;
  }

  return (
    <section style={{ textAlign: 'left' }}>
      <h2 style={{ textAlign: 'left' }}>Wallet Overview</h2>

      {/* Address section - now on ONE line and clickable to copy */}
      <div className="result" style={{ textAlign: 'left' }}>
        <p>
          <strong>Address:</strong>{' '}
          <span
            className="wallet-address"
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              wordBreak: 'break-all',
            }}
            onClick={() => copyToClipboard(wallet.address)}
          >
            {wallet.address}
          </span>
        </p>
      </div>

      {/* Balance section - kept first and clean */}
      <div className="result" style={{ textAlign: 'left' }}>
        <p><strong>Balance:</strong> {balance !== null ? balance : 'Loading...'} WART</p>
        <p><strong>USD Value:</strong> ${usdBalance || 'N/A'}</p>
      </div>

      {/* Action buttons - Refresh + Send Transaction */}
      <div className="flex gap-3 mt-4" style={{ textAlign: 'left', display: 'flex', gap: '1rem', marginTop: '1rem' }}>
        <button onClick={refreshBalance}>Refresh Balance</button>
        <button 
          onClick={() => setCurrentTab('send')}
        >
          Send Transaction
        </button>
      </div>

      {/* Network details - kept in its own result block */}
      <div className="result" style={{ textAlign: 'left' }}>
        <p><strong>Current Node:</strong> {selectedNode}</p>
        <p><strong>Pin Height:</strong> {pinHeight}</p>
        <p><strong>Pin Hash:</strong> {pinHash}</p>
      </div>

      {/* Logout button - at the bottom */}
      <button 
        onClick={onLogout}
        className="px-4 py-2 text-sm font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 dark:text-red-400 dark:border-red-700 transition-colors"
        style={{ textAlign: 'left', display: 'flex', gap: '1rem', marginTop: '1rem' }}
      >
        Logout
      </button>
    </section>
  );
};

export default WalletOverview;