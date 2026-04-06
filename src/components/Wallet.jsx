import React, { useState, useEffect } from 'react';
import { WalletProvider, useWallet } from './WalletContext';
import WalletOverview from './WalletOverview';
import WalletSetup from './WalletSetup';
import SendTransactionPage from './SendTransactionPage';
import TransactionHistoryPage from './TransactionHistoryPage';
import ToolsPage from './ToolsPage';
import NodeSelectionPage from './NodeSelectionPage';
import DeFiTestnetPage from './DeFiTestnetPage';
import AssetPage from './AssetPage';
import DexPage from './DexPage';

const WalletContent = () => {
  const {
    currentTab,
    setCurrentTab,
    isLoggedIn,
    wallet,
    setWallet,
    setIsLoggedIn,
    selectedNode,
    setSelectedNode,
    error,
  } = useWallet();

  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  // PWA logic
  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleUpdateAvailable = () => {
      setUpdateAvailable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('updateavailable', handleUpdateAvailable);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('updateavailable', handleUpdateAvailable);
    };
  }, []);

  const handleInstallClick = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult) => {
        setDeferredPrompt(null);
      });
    }
  };

  const handleUpdate = () => {
    window.location.reload();
  };

  const handleLogout = () => {
    sessionStorage.removeItem('warthogWalletDecrypted');
    setWallet(null);
    setIsLoggedIn(false);
    setCurrentTab('wallet'); // reset to setup
  };

  if (!isLoggedIn) {
    return <WalletSetup />;
  }

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'send', label: 'Send' },
    { key: 'history', label: 'History' },
    { key: 'tools', label: 'Tools' },
    { key: 'node', label: 'Node' },
  ];

  // Add DeFi tabs only for custom/testnet nodes
  const isTestnet = selectedNode && !['https://warthognode.duckdns.org', 'http://217.182.64.43:3001'].includes(selectedNode);
  if (isTestnet) {
    tabs.push({ key: 'assets', label: 'Assets' });
    tabs.push({ key: 'dex', label: 'DEX' });
  }

  const renderTabContent = () => {
    switch (currentTab) {
      case 'overview': return <WalletOverview onLogout={handleLogout} />;
      case 'send': return <SendTransactionPage wallet={wallet} selectedNode={selectedNode} />;
      case 'history': return <TransactionHistoryPage wallet={wallet} selectedNode={selectedNode} />;
      case 'tools': return <ToolsPage selectedNode={selectedNode} />;
      case 'node': return <NodeSelectionPage onNodeChange={setSelectedNode} />;
      case 'assets': return <AssetPage selectedNode={selectedNode} />;
      case 'dex': return <DexPage selectedNode={selectedNode} wallet={wallet} />;
      default: return <WalletOverview onLogout={handleLogout} />;
    }
  };

  return (
    <div className="container">
      <h1>Warthog Network Defi</h1>

      {deferredPrompt && (
        <button onClick={handleInstallClick} className="install-button">
          Install App
        </button>
      )}

      {updateAvailable && (
        <button onClick={handleUpdate} className="install-button">
          Update App Available
        </button>
      )}

      <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setCurrentTab(tab.key)}
            className={`flex-1 py-4 text-sm font-medium whitespace-nowrap ${
              currentTab === tab.key
                ? 'border-b-2 border-orange-400 text-orange-400'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {renderTabContent()}

      {error && (
        <div className="error">
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  );
};

const Wallet = () => {
  return (
    <WalletProvider>
      <WalletContent />
    </WalletProvider>
  );
};

export default Wallet;
