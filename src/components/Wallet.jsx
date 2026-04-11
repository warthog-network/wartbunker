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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // PWA logic (unchanged)
  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleUpdateAvailable = () => setUpdateAvailable(true);

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
      deferredPrompt.userChoice.then(() => setDeferredPrompt(null));
    }
  };

  const handleUpdate = () => window.location.reload();

  const handleLogout = () => {
    sessionStorage.removeItem('warthogWalletDecrypted');
    setWallet(null);
    setIsLoggedIn(false);
    setCurrentTab('wallet');
    setIsMobileMenuOpen(false);
  };

  // Close mobile menu when tab changes
  const handleTabChange = (tabKey) => {
    setCurrentTab(tabKey);
    setIsMobileMenuOpen(false);
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

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 mb-6">
        <h1 className="text-3xl font-bold text-[#FDB913]">Warthog Network Defi</h1>
        {/* Hamburger / Close Button */}
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className={`mobile-hamburger w-[52px] h-[52px] bg-orange-500 hover:bg-orange-600 rounded-xl flex items-center justify-center text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-orange-400 active:scale-95 ${isMobileMenuOpen ? 'z-[60]' : ''}`}
          aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
        >
          {isMobileMenuOpen ? (
            // Close icon (X) - perfectly centered
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-9 h-9 transition-all duration-200"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="3.5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            // Hamburger icon - perfectly centered
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-9 h-9 transition-all duration-200"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="3"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* PWA Buttons */}
      {deferredPrompt && (
        <button onClick={handleInstallClick} className="install-button mb-4">
          Install App
        </button>
      )}
      {updateAvailable && (
        <button onClick={handleUpdate} className="install-button mb-4">
          Update App Available
        </button>
      )}

      {/* Desktop Tabs (≥ 768px) */}
      <div className="desktop-tabs overflow-x-auto pb-4 mb-6 border-b border-gray-700 scrollbar-hide">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setCurrentTab(tab.key)}
            className={`flex-shrink-0 px-6 py-3 text-sm font-medium whitespace-nowrap mx-1 rounded-t-lg transition-all duration-200 ${
              currentTab === tab.key
                ? 'bg-orange-500 text-white border-b-4 border-orange-400'
                : 'text-gray-400 hover:text-gray-200 hover:bg-zinc-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Mobile Menu Overlay */}
      <div className={`mobile-menu fixed top-0 right-0 w-full h-full bg-black/95 z-50 flex flex-col transition-transform duration-300 ease-in-out ${
        isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
      }`}>
        <div className="flex-1 pt-24 px-8 overflow-y-auto">
          <nav className="space-y-3">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`w-full py-5 px-5 text-left text-xl font-semibold rounded-xl transition-all duration-300 min-h-[56px] shadow-sm ${
                  currentTab === tab.key
                    ? 'bg-orange-500 text-white shadow-orange-500/25'
                    : 'text-gray-200 hover:bg-zinc-700 hover:text-white active:bg-zinc-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Logout Button at Bottom */}
        <div className="p-8 border-t border-gray-600">
          <button
            onClick={handleLogout}
            className="w-full py-5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-xl font-semibold transition-all duration-200 min-h-[56px] shadow-lg shadow-red-600/25"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Tab Content */}
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
