import React, { useState, useEffect } from 'react';
import { WalletProvider, useWallet } from './WalletContext';
import { ToastProvider, useToast } from './Toast';
import { NumberDisplayProvider } from './NumberDisplayContext.jsx';
import WalletOverview from './WalletOverview';
import SendTransactionPage from './SendTransactionPage';
import TransactionHistoryPage from './TransactionHistoryPage';
import ToolsPage from './ToolsPage';
import NodeSelectionPage from './NodeSelectionPage';
import DeFiTestnetPage from './DeFiTestnetPage';
import AssetPage from './AssetPage';
import DexPage from './DexPage';
import GatedPage from './GatedPage';
import { isDefiNode } from '../utils/presetNodes.js';
import { clearWalletSession } from '../utils/sessionWallet.js';
import WarthogBrandHeader from './WarthogBrandHeader.jsx';

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
    lockWallet,
    unlockWallet,
    isSessionLocked,
    isSigningUnlocked,
    clearSigningSession,
    registerAutoLockCallback,
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
  const [showUnlockPrompt, setShowUnlockPrompt] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockPromptError, setUnlockPromptError] = useState(null);

  useEffect(() => {
    registerAutoLockCallback?.(({ hasSavedWallet }) => {
      if (hasSavedWallet) {
        toast.info('Wallet auto-locked after inactivity — use Unlock to sign again');
      } else {
        toast.info('Wallet auto-locked after inactivity');
      }
    });
    return () => registerAutoLockCallback?.(null);
  }, [registerAutoLockCallback, toast]);

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

  const handlePromptSaveWallet = async () => {
    setPromptError(null);
    const name = promptWalletName.trim();
    if (!name || !promptPassword || promptPassword !== promptConfirmPassword) {
      setPromptError('Please provide a wallet name and matching passwords to save');
      return;
    }
    const ok = await saveNamedWallet(name, promptPassword);
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

  const handleUnlockWallet = async () => {
    setUnlockPromptError(null);
    if (!unlockPassword) {
      setUnlockPromptError('Password is required to unlock');
      return;
    }
    const ok = await unlockWallet?.(unlockPassword);
    if (ok) {
      toast.success(currentWalletName ? `Unlocked "${currentWalletName}"` : 'Wallet unlocked');
      setShowUnlockPrompt(false);
      setUnlockPassword('');
      setUnlockPromptError(null);
    } else {
      setUnlockPromptError('Unlock failed — check password');
    }
  };

  const handleCancelUnlock = () => {
    setShowUnlockPrompt(false);
    setUnlockPassword('');
    setUnlockPromptError(null);
  };

  const handleLogout = async () => {
    await clearSigningSession?.();
    clearWalletSession();
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
    setShowUnlockPrompt(false);
    setUnlockPassword('');
    setUnlockPromptError(null);
  };

  // Close mobile menu when tab changes
  const handleTabChange = (tabKey) => {
    // Guest users stay on Home (balance-card access) or Network
    if (!isLoggedIn && tabKey !== 'overview' && tabKey !== 'network' && tabKey !== 'node') {
      setCurrentTab('overview');
      setIsMobileMenuOpen(false);
      return;
    }
    setCurrentTab(tabKey);
    setIsMobileMenuOpen(false);
  };

  // Always land guests on overview (guided balance card)
  useEffect(() => {
    if (!isLoggedIn && currentTab !== 'overview' && currentTab !== 'network' && currentTab !== 'node') {
      setCurrentTab('overview');
    }
  }, [isLoggedIn, currentTab, setCurrentTab]);

  const isTestnet = selectedNode && isDefiNode(selectedNode);

  // Logged-in: full nav. Guest: Home + Network only (access is on the balance card).
  const tabs = isLoggedIn
    ? [
        { key: 'overview', label: 'Home' },
        { key: 'send', label: 'Send' },
        { key: 'history', label: 'History' },
        ...(isTestnet ? [{ key: 'assets', label: 'Assets' }] : []),
        { key: 'tools', label: 'Tools' },
        { key: 'network', label: 'Network' },
        { key: 'gated', label: 'Gated' },
      ]
    : [
        { key: 'overview', label: 'Home' },
        { key: 'network', label: 'Network' },
      ];

  const renderTabContent = () => {
    if (!isLoggedIn) {
      switch (currentTab) {
        case 'network':
        case 'node':
          return <NodeSelectionPage onNodeChange={setSelectedNode} />;
        default:
          return <WalletOverview onLogout={handleLogout} />;
      }
    }
    switch (currentTab) {
      case 'overview': return <WalletOverview onLogout={handleLogout} />;
      case 'send': return <SendTransactionPage wallet={wallet} selectedNode={selectedNode} />;
      case 'history': return <TransactionHistoryPage wallet={wallet} selectedNode={selectedNode} />;
      case 'tools': return <ToolsPage selectedNode={selectedNode} wallet={wallet} />;
      case 'gated': return <GatedPage />;
      case 'network':
      case 'node': return <NodeSelectionPage onNodeChange={setSelectedNode} />;
      case 'assets': return <AssetPage selectedNode={selectedNode} />;
      case 'dex': return <DexPage selectedNode={selectedNode} wallet={wallet} />;
      default: return <WalletOverview onLogout={handleLogout} />;
    }
  };

  return (
    <div className="container">

      {/* Header */}
      <div className="flex items-start justify-between px-1 py-4 mb-2 gap-3">
        <WarthogBrandHeader />
        <div className="flex items-center gap-2 flex-shrink-0">
          {isLoggedIn && isSigningUnlocked && (
            <button
              onClick={async () => {
                await lockWallet?.();
                toast.success('Wallet locked — signing disabled until you unlock');
              }}
              className="wallet-action-btn hidden sm:inline-flex"
              title="Lock wallet: remove private key from this browser session"
            >
              Lock
            </button>
          )}

          {isLoggedIn && isSessionLocked && currentWalletName && (
            <button
              onClick={() => setShowUnlockPrompt(true)}
              className="text-xs px-3 py-1.5 rounded-xl border border-emerald-700/60 hover:bg-emerald-900/30 text-emerald-400 hover:text-emerald-300 transition-colors hidden sm:inline-flex"
              title={`Unlock wallet "${currentWalletName}"`}
            >
              Unlock
            </button>
          )}

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

      {/* Desktop Tabs (≥ 768px) — compact; brand hairline under nav */}
      <div className="desktop-tabs relative pb-1 mb-4 border-b border-[#E79300]/35">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide px-0">
          {tabs.map(tab => {
            const isActive = currentTab === tab.key || (tab.key === 'network' && currentTab === 'node');
            return (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`wallet-tab-btn whitespace-nowrap${isActive ? ' wallet-tab-btn--active' : ''}`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
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
                className={`wallet-nav-btn${currentTab === tab.key ? ' wallet-nav-btn--active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-8 border-t border-gray-600 space-y-3">
          {isLoggedIn && isSessionLocked && currentWalletName && (
            <button
              onClick={() => {
                setIsMobileMenuOpen(false);
                setShowUnlockPrompt(true);
              }}
              className="w-full text-xs px-3 py-2 rounded-xl border border-emerald-700/60 hover:bg-emerald-900/30 text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
            >
              Unlock &quot;{currentWalletName}&quot;
            </button>
          )}
          {isLoggedIn ? (
            <button
              onClick={handleLogout}
              className="wallet-action-btn w-full py-5 font-semibold min-h-[56px] !m-0"
            >
              Logout
            </button>
          ) : (
            <p className="text-xs text-zinc-500 text-center leading-relaxed">
              Open a wallet from the Home balance card to unlock Send, History, and more.
            </p>
          )}
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
              This wallet isn&apos;t tagged with an account name yet. Give it a name and password so it is saved in this browser and appears under &quot;Login to Saved Wallet&quot; next time you open Bunker here.
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
              Stores an encrypted copy (private key only) in this browser under your chosen name — not a downloadable file.
              Seed phrase is never saved. Skip if you prefer loading from an encrypted wallet file each time.
            </p>
          </div>
        </div>
      )}

      {showUnlockPrompt && currentWalletName && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-content">
            <h2>Unlock Wallet</h2>
            <p className="text-sm mb-3 text-zinc-300">
              Enter the password for <span className="font-mono text-emerald-400">&quot;{currentWalletName}&quot;</span> to restore the private key into this session.
            </p>

            {unlockPromptError && <div className="error"><p>{unlockPromptError}</p></div>}

            <div className="form-group">
              <label>Password for &quot;{currentWalletName}&quot;:</label>
              <input
                type="password"
                value={unlockPassword}
                onChange={(e) => setUnlockPassword(e.target.value)}
                placeholder="Enter password"
                className="input"
                onKeyDown={(e) => { if (e.key === 'Enter') handleUnlockWallet(); }}
                autoFocus
              />
            </div>

            <div className="flex gap-2 mt-4">
              <button type="button" onClick={handleUnlockWallet} className="wallet-action-btn flex-1 !mx-0 !mb-0">
                Unlock
              </button>
              <button type="button" onClick={handleCancelUnlock} className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1 flex-1">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Wallet = () => {
  return (
    <WalletProvider>
      <NumberDisplayProvider>
        <ToastProvider>
          <WalletContent />
        </ToastProvider>
      </NumberDisplayProvider>
    </WalletProvider>
  );
};

export default Wallet;
