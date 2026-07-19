import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { encryptWallet, decryptWallet, normalizeDecryptedWallet } from '../utils/warthogWalletUtils';
import { clearLegacyAutoMinePrefs, isFakeMineAllowed } from '../utils/nodeAccess';
import {
  createWarthogApi,
  DEFAULT_TX_FEE,
  fetchNodeTxFees,
  normalizeAssetHash,
} from '../utils/warthogClient.js';
import { DEFAULT_NODE_URL, isDefiNode, isMainnetNode, resolveSavedNodeUrl } from '../utils/presetNodes.js';
import { persistSelectedNode, resolveLiveNode } from '../utils/nodeFailover.js';
import {
  getAutoLockMs,
  lockSigningWorker,
  terminateSigningWorker,
  unlockSigningWorker,
  exportWalletFromWorker,
} from '../utils/signingBridge.js';
import {
  clearWalletSession,
  persistPublicSession,
  readPublicSession,
  stripPrivateKey,
} from '../utils/sessionWallet.js';
import {
  clearHistoryPrefetch,
  ensureHistoryPrefetch,
  refreshHistoryPrefetch,
} from '../utils/accountHistoryCache.js';

const WalletContext = createContext();

// useLayoutEffect warns during SSR; use useEffect on the server, useLayoutEffect on the client.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};

export const WalletProvider = ({ children }) => {
  // Always start with safe defaults. This ensures the first render (server HTML + client hydrate)
  // produces identical output. Storage restore happens after hydration (client-only layout effect).
  const [wallet, setWallet] = useState(null);
  /** WART total balance (kept for existing consumers). */
  const [balance, setBalance] = useState(null);
  /** WART free to spend (total − locked − mempool). */
  const [balanceAvailable, setBalanceAvailable] = useState(null);
  /** WART locked in open orders / pending. */
  const [balanceLocked, setBalanceLocked] = useState(null);
  const [usdBalance, setUsdBalance] = useState(null);
  const [nextNonce, setNextNonce] = useState(null);
  const [pinHeight, setPinHeight] = useState(null);
  const [pinHash, setPinHash] = useState(null);
  const [selectedNode, setSelectedNode] = useState(DEFAULT_NODE_URL);
  const [sentTransactions, setSentTransactions] = useState([]);
  const [failedTransactions, setFailedTransactions] = useState([]);
  const [error, setError] = useState(null);
  const [currentTab, setCurrentTab] = useState('overview');
  const [sendAssetPrefill, setSendAssetPrefill] = useState(null);
  const [dexPoolPrefill, setDexPoolPrefill] = useState(null);
  const [overviewLiquidityPositions, setOverviewLiquidityPositions] = useState(null);
  const [overviewLiquidityExpanded, setOverviewLiquidityExpanded] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [currentWalletName, setCurrentWalletName] = useState(null);
  const [isSigningUnlocked, setIsSigningUnlocked] = useState(false);
  const autoLockCallbackRef = useRef(null);
  /** Node minimum fee display string (e.g. "0.00000001"). */
  const [nodeMinFeeStr, setNodeMinFeeStr] = useState(null);
  /** Suggested fee for forms / swap (max of DEFAULT_TX_FEE and node min). */
  const [suggestedTxFee, setSuggestedTxFee] = useState(DEFAULT_TX_FEE);

  // NEW: Asset balances (live fetched data)
  const [assetBalances, setAssetBalances] = useState([]);

  // NEW: Persisted watched asset hashes (what the user wants to track)
  const [watchedAssets, setWatchedAssets] = useState([]); // [{ hash: string, customName?: string }]

  const getWatchedAssetsKey = (address) => address ? `warthogWatchedAssets_${address.toLowerCase()}` : null;

  const isTestnetNode = (node) => isDefiNode(node);

  // Client-only restore from storage. On the client, runs before paint so the logged-in
  // state is restored immediately after hydration without a visible flash.
  useIsomorphicLayoutEffect(() => {
    clearLegacyAutoMinePrefs();

    // Restore preferred node (kept as-is; live failover runs when connecting)
    setSelectedNode(resolveSavedNodeUrl(localStorage.getItem('selectedNode')));

    // Restore public wallet session only — private keys live in the signing worker after unlock.
    try {
      const publicWallet = readPublicSession();
      if (publicWallet?.address) {
        const name = sessionStorage.getItem('warthogCurrentWalletName') || null;
        if (!name) {
          clearWalletSession();
          return;
        }

        setWallet(publicWallet);
        setCurrentWalletName(name);
        setIsLoggedIn(true);
        setIsSigningUnlocked(false);
        setCurrentTab('overview');
      }
    } catch {
      clearWalletSession();
    }
  }, []);

  useEffect(() => {
    setOverviewLiquidityPositions(null);
    setOverviewLiquidityExpanded(false);
  }, [wallet?.address]);

  const activateWalletSession = useCallback(async (fullWallet, walletName = null) => {
    const normalizedWallet = await normalizeDecryptedWallet(fullWallet);

    await unlockSigningWorker(normalizedWallet.privateKey, {
      publicKey: normalizedWallet.publicKey,
      address: normalizedWallet.address,
    });
    const publicWallet = persistPublicSession(normalizedWallet, walletName) || stripPrivateKey(normalizedWallet);

    setWallet(publicWallet);
    setCurrentWalletName(walletName);
    setIsLoggedIn(true);
    setIsSigningUnlocked(true);
    setError(null);
    return publicWallet;
  }, []);

  const lockWallet = useCallback(async () => {
    if (!isSigningUnlocked) return;

    await lockSigningWorker();
    setIsSigningUnlocked(false);
    setError(null);
  }, [isSigningUnlocked]);

  const registerAutoLockCallback = useCallback((callback) => {
    autoLockCallbackRef.current = callback;
  }, []);

  useEffect(() => {
    if (!isSigningUnlocked) return undefined;

    let timerId;
    const autoLockMs = getAutoLockMs();

    const resetTimer = () => {
      clearTimeout(timerId);
      timerId = window.setTimeout(async () => {
        await lockWallet();
        autoLockCallbackRef.current?.({
          reason: 'inactivity',
          hasSavedWallet: Boolean(currentWalletName),
        });
      }, autoLockMs);
    };

    const activityEvents = ['mousedown', 'keydown', 'touchstart', 'click', 'scroll'];
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, resetTimer, { passive: true });
    });
    resetTimer();

    return () => {
      clearTimeout(timerId);
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, resetTimer);
      });
    };
  }, [isSigningUnlocked, lockWallet, currentWalletName]);

  useEffect(() => {
    if (wallet?.address && selectedNode) {
      fetchBalanceAndNonce(wallet.address);
    }
  }, [wallet, selectedNode, refreshTrigger]);

  // Keep min/suggested fees in sync with the selected node (used by Swap, Send, Asset forms).
  useEffect(() => {
    if (!selectedNode) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const api = await createWarthogApi(selectedNode);
        const fees = await fetchNodeTxFees(api);
        if (cancelled) return;
        setNodeMinFeeStr(fees.minFeeStr);
        setSuggestedTxFee(fees.suggestedFeeStr || DEFAULT_TX_FEE);
      } catch (err) {
        if (cancelled) return;
        console.warn('Could not fetch node min fee:', err?.message || err);
        setNodeMinFeeStr(null);
        setSuggestedTxFee(DEFAULT_TX_FEE);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedNode]);

  // Prefetch history via explorer indexer (node fallback) so History tab is warm on open.
  useEffect(() => {
    if (!isLoggedIn || !wallet?.address || !selectedNode) {
      if (!isLoggedIn) clearHistoryPrefetch();
      return undefined;
    }
    ensureHistoryPrefetch(wallet.address, selectedNode);
    return undefined;
  }, [isLoggedIn, wallet?.address, selectedNode]);

  const fetchBalanceAndNonce = async (address) => {
    setError(null);
    setBalance(null);
    setBalanceAvailable(null);
    setBalanceLocked(null);
    setNextNonce(null);
    setPinHeight(null);
    setPinHash(null);

    try {
      // Prefer the selected node; only hop to the next preset when it is dead/bad.
      const live = await resolveLiveNode(selectedNode);
      if (live.switched) {
        persistSelectedNode(live.node);
        setSelectedNode(live.node);
        console.info(
          `[node failover] ${live.fromNode} unreachable — switched to ${live.node}`,
          live.attempts,
        );
      }

      const api = live.api;
      const activeNode = live.node;
      const { normalizeChainPin } = await import('warthog-js');

      const { pinHash, pinHeight } = normalizeChainPin(live.head);
      setPinHeight(pinHeight);
      setPinHash(pinHash);

      const balRes = isMainnetNode(activeNode)
        ? await api.getAccountBalance(address)
        : await api.getAccountWartBalance(address);
      if (!balRes.success) {
        throw new Error(balRes.error || 'Failed to fetch balance');
      }
      const data = balRes.data;

      const { formatBalanceBreakdown, getNextNonceFromAccount } = await import('../utils/warthogFormat.js');

      const wartContainer = isMainnetNode(activeNode) ? data?.balance : data?.wart;
      const wartBreakdown = await formatBalanceBreakdown(wartContainer, { kind: 'wart' });
      setBalance(wartBreakdown.total);
      setBalanceAvailable(wartBreakdown.available);
      setBalanceLocked(wartBreakdown.locked);

      // USD price (via server proxy to avoid CORS) — priced on total holdings
      try {
        const priceResponse = await axios.get('/api/price');
        const price = priceResponse.data?.usd || 0;
        setUsdBalance((parseFloat(wartBreakdown.total) * price).toFixed(2));
      } catch {
        setUsdBalance('N/A');
      }

      if (isMainnetNode(activeNode)) {
        setNextNonce(await getNextNonceFromAccount(data));
      } else {
        setNextNonce(0);
      }
    } catch (err) {
      console.error('Balance fetch error:', err);
      setError(err.message || 'Failed to fetch balance');
      setBalance('0.00000000');
      setBalanceAvailable('0.00000000');
      setBalanceLocked('0.00000000');
      setUsdBalance('N/A');
    }
  };

  // NEW: Fetch balance of a custom asset (total / locked / available)
  const fetchAssetBalance = async (assetHash, assetName = '') => {
    if (!wallet?.address || !selectedNode) return;

    try {
      const api = await createWarthogApi(selectedNode);
      const hash = normalizeAssetHash(assetHash);
      const res = await api.getAccountAssetBalance(wallet.address, hash);
      if (!res.success) {
        throw new Error(res.error || 'Failed to fetch asset balance');
      }
      const data = res.data;

      const tokenInfo = data?.token || {};
      const decimals = tokenInfo.decimals ?? data?.balance?.total?.decimals ?? 8;
      const { formatBalanceBreakdown } = await import('../utils/warthogFormat.js');
      const breakdown = await formatBalanceBreakdown(data?.balance, {
        kind: 'token',
        decimals,
      });

      const finalName = assetName || tokenInfo.name || 'Unknown Asset';

      const newAsset = {
        hash,
        name: finalName,
        balance: breakdown.total,
        available: breakdown.available,
        locked: breakdown.locked,
        mempool: breakdown.mempool,
        hasLocked: breakdown.hasLocked,
        decimals,
      };

      setAssetBalances((prev) => {
        const index = prev.findIndex((a) => a.hash?.toLowerCase() === hash.toLowerCase());
        if (index !== -1) {
          const updated = [...prev];
          updated[index] = newAsset;
          return updated;
        }
        return [...prev, newAsset];
      });
    } catch (err) {
      console.error('Failed to fetch asset balance:', err);
      // Note: UI layer (WalletOverview) shows user-facing toasts for manual fetches.
      // Context itself intentionally does not depend on the toast system.
    }
  };

  // ==================== WATCHED ASSETS PERSISTENCE ====================

  const loadWatchedAssets = (address) => {
    if (!address) return [];
    const key = getWatchedAssetsKey(address);
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to parse watched assets from localStorage');
    }
    return [];
  };

  const saveWatchedAssets = (address, assets) => {
    if (!address) return;
    const key = getWatchedAssetsKey(address);
    try {
      localStorage.setItem(key, JSON.stringify(assets));
    } catch (e) {
      console.warn('Failed to save watched assets to localStorage');
    }
  };

  const addWatchedAsset = (assetHash, customName = '') => {
    if (!wallet?.address || !assetHash) return;

    const normalizedHash = assetHash.toLowerCase();
    setWatchedAssets(prev => {
      const exists = prev.findIndex(a => a.hash.toLowerCase() === normalizedHash);
      let next;
      if (exists !== -1) {
        // Update name if provided
        next = [...prev];
        if (customName) next[exists] = { ...next[exists], customName };
      } else {
        next = [...prev, { hash: normalizedHash, customName: customName || undefined }];
      }
      saveWatchedAssets(wallet.address, next);
      return next;
    });

    // Immediately fetch latest balance for it
    fetchAssetBalance(normalizedHash, customName);
  };

  const removeWatchedAsset = (assetHash) => {
    if (!wallet?.address) return;

    const normalizedHash = assetHash.toLowerCase();
    setWatchedAssets(prev => {
      const next = prev.filter(a => a.hash.toLowerCase() !== normalizedHash);
      saveWatchedAssets(wallet.address, next);
      return next;
    });

    // Also remove from live balances
    setAssetBalances(prev => prev.filter(a => a.hash.toLowerCase() !== normalizedHash));
  };

  const reorderWatchedAssets = useCallback((fromIndex, toIndex) => {
    if (!wallet?.address || fromIndex === toIndex) return;
    if (fromIndex < 0 || toIndex < 0) return;

    setWatchedAssets((prevWatched) => {
      if (fromIndex >= prevWatched.length || toIndex >= prevWatched.length) {
        return prevWatched;
      }

      const nextWatched = [...prevWatched];
      const [moved] = nextWatched.splice(fromIndex, 1);
      nextWatched.splice(toIndex, 0, moved);
      saveWatchedAssets(wallet.address, nextWatched);

      setAssetBalances((prevBalances) => {
        const byHash = new Map(prevBalances.map((a) => [a.hash.toLowerCase(), a]));
        return nextWatched
          .map((w) => byHash.get(w.hash.toLowerCase()))
          .filter(Boolean);
      });

      return nextWatched;
    });
  }, [wallet?.address]);

  const clearWatchedAssets = () => {
    if (!wallet?.address) return;
    const key = getWatchedAssetsKey(wallet.address);
    localStorage.removeItem(key);
    setWatchedAssets([]);
    setAssetBalances([]);
  };

  // ==================== NAMED WALLET SAVE (for tagging unsaved logins) ====================
  const saveNamedWallet = async (name, password) => {
    if (!wallet || !name || !password) {
      setError('Cannot save: no active wallet or missing name/password');
      return false;
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
      setError('Wallet name is required');
      return false;
    }
    try {
      let walletToSave = wallet;
      if (!walletToSave.privateKey) {
        if (!isSigningUnlocked) {
          setError('Unlock your wallet before saving');
          return false;
        }
        walletToSave = await exportWalletFromWorker();
      }

      const encrypted = encryptWallet(walletToSave, password);
      localStorage.setItem(`warthogWallet_${name.trim()}`, encrypted);
      const trimmed = name.trim();
      setCurrentWalletName(trimmed);
      persistPublicSession(wallet, trimmed);
      return true;
    } catch (err) {
      setError('Failed to save named wallet: ' + err.message);
      return false;
    }
  };

  // Load watched assets when wallet changes or logs in
  useEffect(() => {
    if (wallet?.address && isLoggedIn) {
      const loaded = loadWatchedAssets(wallet.address);
      setWatchedAssets(loaded);

      // Fetch balances for all watched assets
      if (loaded.length > 0 && selectedNode) {
        // Small delay to not hammer the node on login
        setTimeout(() => {
          loaded.forEach((asset, idx) => {
            setTimeout(() => {
              fetchAssetBalance(asset.hash, asset.customName);
            }, idx * 180); // stagger requests
          });
        }, 250);
      }
    }
  }, [wallet?.address, isLoggedIn, selectedNode]);

  // Clear assets when logging out or wallet is cleared
  useEffect(() => {
    if (!isLoggedIn || !wallet) {
      setAssetBalances([]);
      setWatchedAssets([]);
      // Note: we do NOT clear currentWalletName here. It is only nulled explicitly
      // on logout paths or "use without naming". Clearing it here was causing the
      // restored name (from session restore) to be wiped during the mount/restore
      // phase after hydration.
    }
  }, [isLoggedIn, wallet]);

  // ==================== END WATCHED ASSETS ====================

  const unlockWallet = async (password) => {
    if (!currentWalletName) {
      setError('No saved wallet name for this session. Log out and use "Login to Saved Wallet" instead.');
      return false;
    }
    if (!wallet?.address) {
      setError('No active wallet session to unlock.');
      return false;
    }

    const encrypted = localStorage.getItem(`warthogWallet_${currentWalletName}`);
    if (!encrypted) {
      setError(`Saved data for "${currentWalletName}" not found in this browser.`);
      return false;
    }

    try {
      const decrypted = await normalizeDecryptedWallet(decryptWallet(encrypted, password));
      if (decrypted.address.toLowerCase() !== wallet.address.toLowerCase()) {
        setError('Decrypted wallet does not match the current locked session address.');
        return false;
      }
      await activateWalletSession(decrypted, currentWalletName);
      return true;
    } catch (err) {
      setError(`Unlock failed: ${err?.message || 'Invalid password or corrupted data'}`);
      return false;
    }
  };

  const isSessionLocked = !!(isLoggedIn && wallet && !isSigningUnlocked && currentWalletName);

  const clearSigningSession = useCallback(async () => {
    await lockSigningWorker();
    terminateSigningWorker();
    setIsSigningUnlocked(false);
  }, []);

  const refreshBalance = () => {
    setRefreshTrigger((prev) => prev + 1);
    if (wallet?.address && selectedNode) {
      refreshHistoryPrefetch(wallet.address, selectedNode);
      // Also refresh asset free/locked so overview matches open orders
      watchedAssets.forEach((asset, idx) => {
        setTimeout(() => {
          fetchAssetBalance(asset.hash, asset.customName);
        }, idx * 120);
      });
    }
  };

  const performFakeMine = async () => {
    if (!wallet?.address || !selectedNode || !isFakeMineAllowed(selectedNode)) {
      return false;
    }

    try {
      const api = await createWarthogApi(selectedNode);
      const res = await api.fakeMine(wallet.address);

      if (res.success) {
        const innerCode = res.data?.code;
        if (innerCode === undefined || innerCode === 0) {
          refreshBalance();
          return true;
        }
        console.warn('Fake mine failed:', res.data?.error || 'Fake mine rejected by node', res);
        return false;
      }

      console.warn('Fake mine failed:', res.error || 'Fake mine rejected by node', res);
      return false;
    } catch (err) {
      console.warn('Fake mine error:', err.message || 'Fake mine request failed');
      return false;
    }
  };

  const value = {
    wallet,
    setWallet,
    balance,
    balanceAvailable,
    balanceLocked,
    usdBalance,
    nextNonce,
    pinHeight,
    pinHash,
    selectedNode,
    setSelectedNode,
    sentTransactions,
    setSentTransactions,
    failedTransactions,
    setFailedTransactions,
    error,
    setError,
    currentTab,
    setCurrentTab,
    sendAssetPrefill,
    setSendAssetPrefill,
    dexPoolPrefill,
    setDexPoolPrefill,
    overviewLiquidityPositions,
    setOverviewLiquidityPositions,
    overviewLiquidityExpanded,
    setOverviewLiquidityExpanded,
    isLoggedIn,
    setIsLoggedIn,
    currentWalletName,
    setCurrentWalletName,
    saveNamedWallet,
    fetchBalanceAndNonce,
    refreshBalance,
    // NEW: Asset system
    assetBalances,
    fetchAssetBalance,
    watchedAssets,
    addWatchedAsset,
    removeWatchedAsset,
    reorderWatchedAssets,
    clearWatchedAssets,
    performFakeMine,
    isFakeMineAllowed,
    isTestnetNode,
    lockWallet,
    unlockWallet,
    isSessionLocked,
    isSigningUnlocked,
    activateWalletSession,
    clearSigningSession,
    registerAutoLockCallback,
    nodeMinFeeStr,
    suggestedTxFee,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};