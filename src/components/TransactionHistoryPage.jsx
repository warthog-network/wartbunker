import React, { useState } from 'react';
import { useWallet } from './WalletContext';
import TransactionHistory from './TransactionHistory';

function readSessionWallet() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const saved = sessionStorage.getItem('warthogWalletDecrypted');
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

const TransactionHistoryPage = ({ wallet: propWallet, selectedNode: propSelectedNode }) => {
  const { wallet: contextWallet, selectedNode: contextSelectedNode } = useWallet();
  const wallet = propWallet || contextWallet || readSessionWallet();
  const selectedNode = propSelectedNode || contextSelectedNode || (() => {
    try {
      return localStorage.getItem('selectedNode') || 'https://warthognode.duckdns.org';
    } catch {
      return 'https://warthognode.duckdns.org';
    }
  })();

  const [blockCounts, setBlockCounts] = useState({
    '24h': 0,
    week: 0,
    month: 0,
    rewards24h: [],
    rewardsWeek: [],
    rewardsMonth: [],
  });
  const [refreshHistory, setRefreshHistory] = useState(0);

  if (!wallet?.address) {
    return (
      <section>
        <h2>Transaction History</h2>
        <p>Please log in to view transaction history.</p>
      </section>
    );
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