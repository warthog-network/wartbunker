import React, { useState, useEffect } from 'react';
import { WalletProvider, useWallet } from './WalletContext';
import { ToastProvider, useToast } from './Toast';
import WalletOverview from './WalletOverview';
import WalletSetup from './WalletSetup';
import SendTransactionPage from './SendTransactionPage';
import TransactionHistoryPage from './TransactionHistoryPage';
import ToolsPage from './ToolsPage';
import NodeSelectionPage from './NodeSelectionPage';
import DeFiTestnetPage from './DeFiTestnetPage';
import AssetPage from './AssetPage';
import DexPage from './DexPage';
import GatedPage from './GatedPage';
import TokenGate from './TokenGate';

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
    currentWalletName,
    setCurrentWalletName,
    saveNamedWallet,
  } = useWallet();

  const toast = useToast();

  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // For prompting to name/tag a wallet on login if not already saved under a name
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [promptWalletName, setPromptWalletName] = useState('');
  const [promptPassword, setPromptPassword] = useState('');
  const [promptConfirmPassword, setPromptConfirmPassword] = useState('');
  const [promptError, setPromptError] = useState(null);
  const [namePromptDismissed, setNamePromptDismissed] = useState(false);

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

  // Auto-open the name/tag prompt when logged in with a wallet that has no current name (i.e. not loaded from a saved named entry)
  useEffect(() => {
    if (isLoggedIn && wallet && !currentWalletName && !namePromptDismissed) {
      setShowNamePrompt(true);
    } else if (!isLoggedIn || currentWalletName) {
      setShowNamePrompt(false);
    }
  }, [isLoggedIn, wallet, currentWalletName, namePromptDismissed]);

  const handleInstallClick = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => setDeferredPrompt(null));
    }
  };

  const handleUpdate = () => window.location.reload();

  const handlePromptSaveWallet = () => {
    setPromptError(null);
    const name = promptWalletName.trim();
    if (!name || !promptPassword || promptPassword !== promptConfirmPassword) {
      setPromptError('Please provide a wallet name and matching passwords to save');
      return;
    }
    const ok = saveNamedWallet(name, promptPassword);
    if (ok) {
      toast.success(`Wallet saved as "${name}"`);
      setShowNamePrompt(false);
      setPromptWalletName('');
      setPromptPassword('');
      setPromptConfirmPassword('');
      setPromptError(null);
      setNamePromptDismissed(false);
    } else {
      setPromptError('Save failed (check console or top error)');
    }
  };

  const handleSkipNamePrompt = () => {
    setShowNamePrompt(false);
    setNamePromptDismissed(true);
    setPromptWalletName('');
    setPromptPassword('');
    setPromptConfirmPassword('');
    setPromptError(null);
    toast.info('Wallet session active. You can name & save it later for easy login.');
  };

  const handleLogout = () => {
    sessionStorage.removeItem('warthogWalletDecrypted');
    sessionStorage.removeItem('warthogCurrentWalletName');
    setWallet(null);
    setIsLoggedIn(false);
    setCurrentWalletName(null);  // explicitly clear the saved name association
    setCurrentTab('wallet');
    setIsMobileMenuOpen(false);
    // reset prompt state for next login
    setShowNamePrompt(false);
    setNamePromptDismissed(false);
    setPromptWalletName('');
    setPromptPassword('');
    setPromptConfirmPassword('');
    setPromptError(null);
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
    { key: 'gated', label: 'Gated' },
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
      case 'gated': return <GatedPage />;
      case 'node': return <NodeSelectionPage onNodeChange={setSelectedNode} />;
      case 'assets': return <AssetPage selectedNode={selectedNode} />;
      case 'dex': return <DexPage selectedNode={selectedNode} wallet={wallet} />;
      default: return <WalletOverview onLogout={handleLogout} />;
    }
  };

  return (
    <div className="container">

      {/* Header */}
      <div className="flex items-center justify-between px-1 py-4 mb-2">
        <div>
          <div className="text-[22px] font-semibold tracking-[-0.4px] text-[#FDB913]">Warthog</div>
          <div className="text-[10px] text-zinc-500 -mt-0.5 font-mono">NETWORK DEFI</div>
        </div>
        {/* Hamburger / Close Button */}
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className={`mobile-hamburger w-[48px] h-[48px] bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-2xl flex items-center justify-center text-white transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 active:scale-[0.96] ${isMobileMenuOpen ? 'z-[60] bg-zinc-800' : ''}`}
          aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
        >
          {isMobileMenuOpen ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.25">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* PWA Install / Update (subtle row) */}
      {(deferredPrompt || updateAvailable) && (
        <div className="flex flex-wrap gap-2 mb-4 px-1">
          {deferredPrompt && (
            <button onClick={handleInstallClick} className="px-4 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-2xl text-orange-400 transition-colors">
              Install as App
            </button>
          )}
          {updateAvailable && (
            <button onClick={handleUpdate} className="px-4 py-1.5 text-xs font-medium bg-emerald-900/60 hover:bg-emerald-900 border border-emerald-800 rounded-2xl text-emerald-400 transition-colors">
              Update Available
            </button>
          )}
        </div>
      )}

      {/* Desktop Tabs (≥ 768px) — smoother active indicator */}
      <div className="desktop-tabs relative overflow-x-auto pb-1 mb-6 border-b border-zinc-800 scrollbar-hide">
        <div className="flex gap-1 px-1">
          {tabs.map(tab => {
            const isActive = currentTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setCurrentTab(tab.key)}
                className={`flex-shrink-0 px-5 py-2.5 text-sm font-semibold whitespace-nowrap rounded-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 ${
                  isActive
                    ? 'bg-zinc-900 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-950'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        {/* Active underline indicator (subtle) */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-orange-500/60 to-transparent" />
      </div>

      {/* Mobile Menu Overlay + Backdrop */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/70 z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}
      <div className={`mobile-menu fixed top-0 right-0 w-full h-full bg-zinc-950 z-50 flex flex-col transition-transform duration-300 ease-out md:hidden ${
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
        <div className="mt-6 mx-1 rounded-2xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          <span className="font-semibold text-red-400">Error:</span> {error}
        </div>
      )}

      {/* Prompt to name/tag the wallet if logged in but not from a pre-named saved wallet entry */}
      {showNamePrompt && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-content">
            <h2>Name &amp; Save This Wallet</h2>
            <p className="text-sm mb-3 text-zinc-300">
              This wallet isn't tagged with an account name yet. Give it a name and password so you can select it easily from "Login to Saved Wallet" next time.
            </p>
            {promptError && <div className="error"><p>{promptError}</p></div>}
            <div className="form-group">
              <label>Wallet Name:</label>
              <input
                type="text"
                value={promptWalletName}
                onChange={(e) => setPromptWalletName(e.target.value)}
                placeholder="e.g. main-wallet or trading"
                className="input"
              />
            </div>
            <div className="form-group">
              <label>Password:</label>
              <input
                type="password"
                value={promptPassword}
                onChange={(e) => setPromptPassword(e.target.value)}
                placeholder="Password to encrypt saved wallet"
                className="input"
              />
            </div>
            <div className="form-group">
              <label>Confirm Password:</label>
              <input
                type="password"
                value={promptConfirmPassword}
                onChange={(e) => setPromptConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                className="input"
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button onClick={handlePromptSaveWallet} style={{ flex: 1 }}>Save &amp; Tag Wallet</button>
              <button onClick={handleSkipNamePrompt} style={{ flex: 1, background: '#3f3f46' }}>Skip for Now</button>
            </div>
            <p className="text-[10px] text-zinc-500 mt-3">
              This stores an encrypted copy (private key only) in localStorage under your chosen name. Mnemonic is never saved. Skip if you prefer loading from file each time.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

const Wallet = () => {
  return (
    <WalletProvider>
      <ToastProvider>
        <WalletContent />
      </ToastProvider>
    </WalletProvider>
  );
};

export default Wallet;
