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
import {
  isWebAuthnAvailable,
  inspectWalletBlob,
} from '../utils/passkeyWallet.js';
import { paintPasskeyWaiting, clearPasskeyWaiting } from '../utils/passkeyUi.js';

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
    enablePasskeyOnCurrentWallet,
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

  const [showUnlockPrompt, setShowUnlockPrompt] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockPromptError, setUnlockPromptError] = useState(null);
  const [passkeysSupported, setPasskeysSupported] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [savedAuthInfo, setSavedAuthInfo] = useState({
    hasPasskey: false,
    hasPassword: true,
    require2fa: false,
  });

  useEffect(() => {
    setPasskeysSupported(isWebAuthnAvailable());
  }, []);

  useEffect(() => {
    if (!currentWalletName || typeof localStorage === 'undefined') {
      setSavedAuthInfo({ hasPasskey: false, hasPassword: true, require2fa: false });
      return;
    }
    const raw = localStorage.getItem(`warthogWallet_${currentWalletName}`);
    const info = inspectWalletBlob(raw);
    setSavedAuthInfo({
      hasPasskey: info.hasPasskey,
      hasPassword: info.hasPassword,
      require2fa: info.require2fa,
    });
  }, [currentWalletName, showUnlockPrompt, isSessionLocked]);

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

  const handleInstallClick = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => setDeferredPrompt(null));
    }
  };

  const handleUpdate = () => window.location.reload();

  const handleEnablePasskey = async () => {
    try {
      await paintPasskeyWaiting(setPasskeyBusy);
      const ok = await enablePasskeyOnCurrentWallet({
        preferFingerprint: false,
        require2fa: false,
      });
      if (ok) {
        toast.success('Passkey enabled — next login: Unlock with passkey');
        // refresh badge
        if (currentWalletName && typeof localStorage !== 'undefined') {
          try {
            const raw = localStorage.getItem(`warthogWallet_${currentWalletName}`);
            const info = inspectWalletBlob(raw);
            setSavedAuthInfo({
              hasPasskey: Boolean(info.hasPasskey),
              hasPassword: info.hasPassword !== false,
              require2fa: Boolean(info.require2fa),
            });
          } catch {
            /* ignore */
          }
        }
      } else {
        toast.error('Could not enable passkey — see error above');
      }
    } finally {
      clearPasskeyWaiting(setPasskeyBusy);
    }
  };

  const handleUnlockWallet = async (usePasskey = false) => {
    setUnlockPromptError(null);
    if (savedAuthInfo.require2fa) {
      if (!unlockPassword) {
        setUnlockPromptError('2FA: enter password, then confirm with passkey');
        return;
      }
      try {
        await paintPasskeyWaiting(setPasskeyBusy);
        const ok = await unlockWallet?.(unlockPassword);
        if (ok) {
          toast.success(currentWalletName ? `Unlocked "${currentWalletName}" (2FA)` : 'Wallet unlocked');
          setShowUnlockPrompt(false);
          setUnlockPassword('');
          setUnlockPromptError(null);
        } else {
          setUnlockPromptError('Unlock failed — check password and passkey');
        }
      } finally {
        clearPasskeyWaiting(setPasskeyBusy);
      }
      return;
    }
    if (usePasskey) {
      try {
        await paintPasskeyWaiting(setPasskeyBusy);
        const ok = await unlockWallet?.(null, { usePasskey: true });
        if (ok) {
          toast.success(currentWalletName ? `Unlocked "${currentWalletName}"` : 'Wallet unlocked');
          setShowUnlockPrompt(false);
          setUnlockPassword('');
          setUnlockPromptError(null);
        } else {
          setUnlockPromptError('Passkey unlock failed');
        }
      } finally {
        clearPasskeyWaiting(setPasskeyBusy);
      }
      return;
    }
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

      {passkeyBusy && (
        <div className="passkey-wait-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="passkey-wait-card">
            <div className="passkey-spinner" aria-hidden="true" />
            <p className="passkey-wait-title">Waiting for passkey…</p>
            <p className="passkey-wait-hint">
              Complete the browser or device prompt (PIN, biometrics, or password manager). This can take a moment.
            </p>
          </div>
        </div>
      )}

      {/* Always-visible passkey CTA when logged in (mobile + desktop) */}
      {isLoggedIn && isSigningUnlocked && !savedAuthInfo.hasPasskey && (
        <div
          className="mb-4 px-3 py-3 rounded-xl border border-amber-600/50 bg-amber-950/30"
          data-passkey-cta="enable"
        >
          <button
            type="button"
            className="wallet-action-btn w-full !mx-0 !mb-2 !min-h-[3rem] !text-base !font-bold"
            disabled={passkeyBusy}
            data-action="enable-passkey"
            onClick={handleEnablePasskey}
          >
            {passkeyBusy ? (
              <>
                <span className="btn-inline-spinner" aria-hidden="true" />
                Waiting for passkey…
              </>
            ) : (
              'Enable passkey'
            )}
          </button>
          <p className="text-xs text-zinc-400 m-0 leading-snug">
            Save a passkey in your password manager or on this device for one-tap unlock next time.
            Sends do not re-prompt while unlocked.
          </p>
        </div>
      )}
      {isLoggedIn && savedAuthInfo.hasPasskey && (
        <div
          className="mb-4 px-3 py-2.5 rounded-xl border border-emerald-700/40 bg-emerald-950/20 flex flex-wrap items-center justify-between gap-2"
          data-passkey-cta="enabled"
        >
          <span className="text-sm font-semibold text-emerald-400">✓ Passkey enabled</span>
          <button
            type="button"
            className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1"
            disabled={passkeyBusy || !isSigningUnlocked}
            onClick={handleEnablePasskey}
          >
            {passkeyBusy ? 'Waiting…' : 'Re-enable passkey'}
          </button>
        </div>
      )}

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

      {showUnlockPrompt && currentWalletName && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-content">
            <h2>Unlock Wallet</h2>
            <p className="text-sm mb-3 text-zinc-300">
              {savedAuthInfo.require2fa
                ? <>2FA: password + passkey for <span className="font-mono text-emerald-400">&quot;{currentWalletName}&quot;</span>.</>
                : <>Restore the private key for <span className="font-mono text-emerald-400">&quot;{currentWalletName}&quot;</span>.</>}
            </p>

            {unlockPromptError && <div className="error"><p>{unlockPromptError}</p></div>}

            {savedAuthInfo.hasPasskey && passkeysSupported && !savedAuthInfo.require2fa && (
              <button
                type="button"
                onClick={() => handleUnlockWallet(true)}
                className="wallet-action-btn w-full !mx-0 !mb-3"
                disabled={passkeyBusy}
              >
                {passkeyBusy ? (
                  <>
                    <span className="btn-inline-spinner" aria-hidden="true" />
                    Waiting for passkey…
                  </>
                ) : (
                  'Unlock with passkey'
                )}
              </button>
            )}

            {(savedAuthInfo.hasPassword || savedAuthInfo.require2fa || !savedAuthInfo.hasPasskey) && (
              <div className="form-group">
                <label>
                  {savedAuthInfo.require2fa
                    ? 'Password (then passkey)'
                    : `Password for "${currentWalletName}"`}
                  :
                </label>
                <input
                  type="password"
                  value={unlockPassword}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                  placeholder="Enter password"
                  className="input"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleUnlockWallet(false); }}
                  autoFocus={!savedAuthInfo.hasPasskey || savedAuthInfo.require2fa}
                />
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => handleUnlockWallet(false)}
                className="wallet-action-btn flex-1 !mx-0 !mb-0"
              >
                {savedAuthInfo.require2fa
                  ? 'Unlock with password + passkey'
                  : 'Unlock with password'}
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
