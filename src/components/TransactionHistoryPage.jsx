import React, { useState, useEffect } from 'react';
import CryptoJS from 'crypto-js';
import TransactionHistory from './TransactionHistory';
import { getCleanWallet } from '../utils/warthogWalletUtils';

const TransactionHistoryPage = ({ wallet: propWallet, selectedNode: propSelectedNode }) => {
  // Use props or fallback (safe for SSR)
  const wallet = propWallet || (() => {
    try {
      if (typeof sessionStorage === 'undefined') return null;
      const saved = sessionStorage.getItem('warthogWalletDecrypted');
      const parsed = saved ? JSON.parse(saved) : null;
      // Returns a safe view (address + publicKey only). Signing key never lives in sessionStorage.
      return getCleanWallet(parsed) || (parsed ? { address: parsed.address, publicKey: parsed.publicKey } : null);
    } catch {
      return null;
    }
  })();
  const selectedNode = propSelectedNode || (() => {
    try {
      if (typeof localStorage === 'undefined') return 'https://warthognode.duckdns.org';
      return localStorage.getItem('selectedNode') || 'https://warthognode.duckdns.org';
    } catch {
      return 'https://warthognode.duckdns.org';
    }
  })();
  const [blockCounts, setBlockCounts] = useState({ '24h': 0, week: 0, month: 0, rewards24h: [], rewardsWeek: [], rewardsMonth: [] });
  const [refreshHistory, setRefreshHistory] = useState(false);

  if (!wallet) {
    return <section><h2>Transaction History</h2><p>Please log in to view transaction history.</p></section>;
  }

  return (
    <TransactionHistory
      address={wallet.address}
      node={selectedNode}
      onCountsUpdate={setBlockCounts}
      blockCounts={blockCounts}
      refreshTrigger={refreshHistory}
    />
  );
};

export default TransactionHistoryPage;
