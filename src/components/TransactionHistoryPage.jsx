import React, { useState, useEffect } from 'react';
import CryptoJS from 'crypto-js';
import TransactionHistory from './TransactionHistory';

const TransactionHistoryPage = ({ wallet: propWallet, selectedNode: propSelectedNode }) => {
  // Use props or fallback
  const wallet = propWallet || (sessionStorage.getItem('warthogWalletDecrypted') ? JSON.parse(sessionStorage.getItem('warthogWalletDecrypted')) : null);
  const selectedNode = propSelectedNode || localStorage.getItem('selectedNode') || 'https://warthognode.duckdns.org';
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
