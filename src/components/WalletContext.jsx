import React, { createContext, useContext, useState, useEffect, useLayoutEffect } from 'react';
import axios from 'axios';
import { encryptWallet, decryptWallet } from '../utils/warthogWalletUtils';
import { clearLegacyAutoMinePrefs, isFakeMineAllowed } from '../utils/nodeAccess';

const API_URL = '/api/proxy';

const WalletContext = createContext();

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};

export const WalletProvider = ({ children }) => {
  // Always start with safe defaults. This ensures the first render (server HTML + client hydrate)
  // produces identical output. Storage restore happens in useLayoutEffect after hydration.
  const [wallet, setWallet] = useState(null);
  const [balance, setBalance] = useState(null);
  const [usdBalance, setUsdBalance] = useState(null);
  const [nextNonce, setNextNonce] = useState(null);
  const [pinHeight, setPinHeight] = useState(null);
  const [pinHash, setPinHash] = useState(null);
  const [selectedNode, setSelectedNode] = useState('https://warthognode.duckdns.org');
  const [sentTransactions, setSentTransactions] = useState([]);
  const [failedTransactions, setFailedTransactions] = useState([]);
  const [error, setError] = useState(null);
  const [currentTab, setCurrentTab] = useState('overview');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [currentWalletName, setCurrentWalletName] = useState(null);

  // NEW: Asset balances (live fetched data)
  const [assetBalances, setAssetBalances] = useState([]);

  // NEW: Persisted watched asset hashes (what the user wants to track)
  const [watchedAssets, setWatchedAssets] = useState([]); // [{ hash: string, customName?: string }]

  const getWatchedAssetsKey = (address) => address ? `warthogWatchedAssets_${address.toLowerCase()}` : null;

  const isTestnetNode = (node) => {
    if (!node) return false;
    const n = node.toLowerCase();
    return n.includes('localhost') ||
           n.includes('127.0.0.1') ||
           n.includes('defitestnet') ||
           n.includes('testnet');
  };

  const isMainnetNode = (node) => 
    node === 'https://warthognode.duckdns.org' || 
    node === 'http://217.182.64.43:3001';

  // Client-only restore from storage. Using useLayoutEffect so state updates happen
  // synchronously before the browser paints. This guarantees the *first* render
  // (server + hydrate) always matches, avoiding hydration mismatch, while still
  // restoring the logged-in named wallet state immediately after.
  useLayoutEffect(() => {
    clearLegacyAutoMinePrefs();

    // Restore preferred node
    const savedNode = localStorage.getItem('selectedNode') || 'https://warthognode.duckdns.org';
    setSelectedNode(savedNode);

    // Restore active wallet session (decrypted data lives in sessionStorage)
    try {
      const decryptedWallet = sessionStorage.getItem('warthogWalletDecrypted');
      if (decryptedWallet) {
        const parsed = JSON.parse(decryptedWallet);
        setWallet(parsed);

        const name = sessionStorage.getItem('warthogCurrentWalletName') || null;
        setCurrentWalletName(name);

        setIsLoggedIn(true);
        setCurrentTab('overview');
      }
    } catch {
      // corrupt or missing data — stay logged out
    }
  }, []);

  useEffect(() => {
    if (wallet?.address && selectedNode) {
      fetchBalanceAndNonce(wallet.address);
    }
  }, [wallet, selectedNode, refreshTrigger]);

  const unwrapResponse = (responseData) => {
    if (responseData?.data && (responseData.status !== undefined || responseData.data?.wart || responseData.data?.chainHead)) {
      return responseData.data;
    }
    return responseData;
  };

  const fetchBalanceAndNonce = async (address) => {
    setError(null);
    setBalance(null);
    setNextNonce(null);
    setPinHeight(null);
    setPinHash(null);

    try {
      const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;

      // Chain Head
      const chainHeadResponse = await axios.get(`${API_URL}?nodePath=chain/head&${nodeBaseParam}`);
      let headRaw = unwrapResponse(chainHeadResponse.data);
      const chainHead = headRaw?.chainHead || headRaw;

      setPinHeight(chainHead?.pinHeight ?? chainHead?.height ?? null);
      setPinHash(chainHead?.pinHash ?? null);

      // Balance
      let balanceResponse;
      if (isMainnetNode(selectedNode)) {
        balanceResponse = await axios.get(`${API_URL}?nodePath=account/${address}/balance&${nodeBaseParam}`);
      } else {
        balanceResponse = await axios.get(`${API_URL}?nodePath=account/${address}/wart_balance&${nodeBaseParam}`);
      }

      let balRaw = unwrapResponse(balanceResponse.data);
      const data = balRaw.data || balRaw;

      const { formatWartBalance, getNextNonceFromAccount } = await import('../utils/warthogFormat.js');

      const wartBalanceObj = isMainnetNode(selectedNode)
        ? data?.balance?.total
        : data?.wart?.total;

      const balanceInWart = await formatWartBalance(wartBalanceObj);
      setBalance(balanceInWart);

      // USD price (via server proxy to avoid CORS)
      try {
        const priceResponse = await axios.get('/api/price');
        const price = priceResponse.data?.usd || 0;
        setUsdBalance((parseFloat(balanceInWart) * price).toFixed(2));
      } catch {
        setUsdBalance('N/A');
      }

      // Nonce
      if (isMainnetNode(selectedNode)) {
        setNextNonce(await getNextNonceFromAccount(data));
      } else {
        setNextNonce(0);
      }
    } catch (err) {
      console.error('Balance fetch error:', err);
      setError(err.response?.data?.message || err.message || 'Failed to fetch balance');
      setBalance('0.00000000');
      setUsdBalance('N/A');
    }
  };

  // NEW: Fetch balance of a custom asset
 const fetchAssetBalance = async (assetHash, assetName = '') => {
  if (!wallet?.address || !selectedNode) return;

  try {
    const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;
    const url = `${API_URL}?nodePath=account/${wallet.address}/balance/asset:${assetHash}&${nodeBaseParam}`;

    const response = await axios.get(url);
    const data = response.data?.data || response.data;

    // Extract from the correct structure
    const tokenInfo = data?.token || {};
    const balanceInfo = data?.balance?.total || data?.balance || {};

    const decimals = tokenInfo.decimals || balanceInfo.decimals || 8;
    const { formatTokenBalance } = await import('../utils/warthogFormat.js');
    const balanceStr = await formatTokenBalance(balanceInfo, decimals);

    const finalName = assetName || tokenInfo.name || 'Unknown Asset';

    const newAsset = {
      hash: assetHash,
      name: finalName,
      balance: balanceStr,
      decimals: decimals,
    };

    setAssetBalances(prev => {
      const index = prev.findIndex(a => a.hash === assetHash);
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

  const clearWatchedAssets = () => {
    if (!wallet?.address) return;
    const key = getWatchedAssetsKey(wallet.address);
    localStorage.removeItem(key);
    setWatchedAssets([]);
    setAssetBalances([]);
  };

  // ==================== NAMED WALLET SAVE (for tagging unsaved logins) ====================
  const saveNamedWallet = (name, password) => {
    if (!wallet || !name || !password) {
      setError('Cannot save: no active wallet or missing name/password');
      return false;
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
      setError('Wallet name is required');
      return false;
    }
    try {
      const encrypted = encryptWallet(wallet, password);
      localStorage.setItem(`warthogWallet_${name.trim()}`, encrypted);
      const trimmed = name.trim();
      setCurrentWalletName(trimmed);
      sessionStorage.setItem('warthogCurrentWalletName', trimmed);
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
      // restored name (from useLayoutEffect) to be wiped during the mount/restore
      // phase after hydration.
    }
  }, [isLoggedIn, wallet]);

  // ==================== END WATCHED ASSETS ====================

  const lockWallet = () => {
    if (!wallet?.privateKey) return;

    const lockedWallet = {
      address: wallet.address,
      publicKey: wallet.publicKey,
    };

    setWallet(lockedWallet);
    try {
      sessionStorage.setItem('warthogWalletDecrypted', JSON.stringify(lockedWallet));
    } catch {
      // in-memory strip is enough
    }
  };

  const unlockWallet = (password) => {
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
      const decrypted = decryptWallet(encrypted, password);
      if (!decrypted?.address) {
        throw new Error('Invalid decrypted wallet data');
      }
      if (decrypted.address.toLowerCase() !== wallet.address.toLowerCase()) {
        setError('Decrypted wallet does not match the current locked session address.');
        return false;
      }
      setWallet(decrypted);
      sessionStorage.setItem('warthogWalletDecrypted', JSON.stringify(decrypted));
      setError(null);
      return true;
    } catch (err) {
      setError(`Unlock failed: ${err?.message || 'Invalid password or corrupted data'}`);
      return false;
    }
  };

  const isSessionLocked = !!(isLoggedIn && wallet && !wallet.privateKey && currentWalletName);

  const refreshBalance = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const performFakeMine = async () => {
    if (!wallet?.address || !selectedNode || !isFakeMineAllowed(selectedNode)) {
      return false;
    }

    try {
      const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;
      const response = await axios.get(
        `${API_URL}?nodePath=debug/fakemine/${wallet.address}&${nodeBaseParam}`,
      );
      const data = response.data;
      const innerCode = data?.data?.code;
      const ok = data?.code === 0 && (innerCode === undefined || innerCode === 0);

      if (ok) {
        refreshBalance();
        return true;
      }

      const errMsg = data?.error || data?.data?.error || 'Fake mine rejected by node';
      console.warn('Fake mine failed:', errMsg, data);
      return false;
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message || 'Fake mine request failed';
      console.warn('Fake mine error:', errMsg);
      return false;
    }
  };

  const value = {
    wallet,
    setWallet,
    balance,
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
    clearWatchedAssets,
    performFakeMine,
    isFakeMineAllowed,
    isTestnetNode,
    lockWallet,
    unlockWallet,
    isSessionLocked,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};