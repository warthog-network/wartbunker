import React, { createContext, useContext, useState, useEffect, useLayoutEffect } from 'react';
import axios from 'axios';
import { encryptWallet } from '../utils/warthogWalletUtils';

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

  // ==================== AUTO FAKE MINING (Testnet only) ====================
  const [isAutoMining, setIsAutoMining] = useState(false);
  const [autoMineCount, setAutoMineCount] = useState(0);
  const autoMineIntervalRef = React.useRef(null);

  // Refs to always use the latest function versions inside setInterval / setTimeout
  const performFakeMineRef = React.useRef(null);
  const refreshBalanceRef = React.useRef(null);

  const isTestnetNode = (node) => {
    if (!node) return false;
    const n = node.toLowerCase();
    return n.includes('localhost') ||
           n.includes('127.0.0.1') ||
           n.includes('defitestnet') ||
           n.includes('testnet');
  };

  const getFakeMineUrl = (address, node) => {
    if (!address) return null;
    // For the public DeFi testnet, we hit the known debug endpoint
    if (node?.includes('defitestnet') || node?.includes('warthog-defitestnet')) {
      return `https://warthog-defitestnet.duckdns.org/debug/fakemine/${address}`;
    }
    // For local nodes, we assume the debug endpoint is available on the same host
    try {
      const url = new URL(node);
      return `${url.origin}/debug/fakemine/${address}`;
    } catch {
      return null;
    }
  };

  const isMainnetNode = (node) => 
    node === 'https://warthognode.duckdns.org' || 
    node === 'http://217.182.64.43:3001';

  // Client-only restore from storage. Using useLayoutEffect so state updates happen
  // synchronously before the browser paints. This guarantees the *first* render
  // (server + hydrate) always matches, avoiding hydration mismatch, while still
  // restoring the logged-in named wallet state immediately after.
  useLayoutEffect(() => {
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

  const getBalanceStr = (wartObj) => {
    if (!wartObj) return null;
    if (wartObj.str) return wartObj.str;
    if (wartObj.E8 !== undefined) {
      return (Number(wartObj.E8) / 100000000).toFixed(8);
    }
    return null;
  };

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

      let balanceInWart = '0.00000000';

      if (isMainnetNode(selectedNode)) {
        if (data?.balance?.total?.str) {
          balanceInWart = data.balance.total.str;
        } else if (data?.balance?.total?.E8 !== undefined) {
          balanceInWart = (Number(data.balance.total.E8) / 100000000).toFixed(8);
        }
      } else {
        if (data?.wart?.total?.str) {
          balanceInWart = data.wart.total.str;
        } else if (data?.wart?.total?.E8 !== undefined) {
          balanceInWart = (Number(data.wart.total.E8) / 100000000).toFixed(8);
        }
      }

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
      if (isMainnetNode(selectedNode) && (data?.nonceId !== undefined || data?.nonce !== undefined)) {
        setNextNonce(Number(data.nonceId || data.nonce) + 1);
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

    let balanceStr = '0';
    if (balanceInfo.str) {
      balanceStr = balanceInfo.str;
    } else if (balanceInfo.u64 !== undefined) {
      balanceStr = (Number(balanceInfo.u64) / Math.pow(10, decimals)).toFixed(decimals);
    } else if (balanceInfo.E8 !== undefined) {
      balanceStr = (Number(balanceInfo.E8) / Math.pow(10, decimals)).toFixed(decimals);
    }

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

  // ==================== PURE TOKEN / ASSET BALANCE CHECK (for gating) ====================
  // Does NOT mutate watchedAssets or assetBalances. Safe for token gating checks.
  const checkAssetBalance = async (assetHash) => {
    if (!wallet?.address || !selectedNode || !assetHash) {
      return { balance: '0', decimals: 8, hasBalance: false };
    }

    const normalized = assetHash.toLowerCase().replace(/^0x/, '');

    try {
      const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;
      const url = `${API_URL}?nodePath=account/${wallet.address}/balance/asset:${normalized}&${nodeBaseParam}`;

      const response = await axios.get(url);
      const data = response.data?.data || response.data;

      const tokenInfo = data?.token || {};
      const balanceInfo = data?.balance?.total || data?.balance || {};

      const decimals = tokenInfo.decimals ?? balanceInfo.decimals ?? 8;

      let balanceStr = '0';
      if (balanceInfo.str) {
        balanceStr = balanceInfo.str;
      } else if (balanceInfo.u64 !== undefined) {
        balanceStr = (Number(balanceInfo.u64) / Math.pow(10, decimals)).toFixed(decimals);
      } else if (balanceInfo.E8 !== undefined) {
        balanceStr = (Number(balanceInfo.E8) / Math.pow(10, decimals)).toFixed(decimals);
      }

      return {
        balance: balanceStr,
        decimals,
        hasBalance: parseFloat(balanceStr) > 0,
        raw: data,
      };
    } catch (err) {
      // If the endpoint 404s or asset doesn't exist for the account, treat as zero balance
      if (err.response?.status === 404) {
        return { balance: '0', decimals: 8, hasBalance: false };
      }
      console.error('checkAssetBalance error:', err);
      return { balance: '0', decimals: 8, hasBalance: false, error: err.message };
    }
  };

  // Helper for gating: returns true if the user holds at least minBalance of the asset
  const hasAssetBalance = async (assetHash, minBalance = '0') => {
    const { balance } = await checkAssetBalance(assetHash);
    const balNum = parseFloat(balance || '0');
    const minNum = parseFloat(minBalance || '0');
    return balNum >= minNum;
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

  // ==================== AUTO MINING FUNCTIONS ====================

  const performFakeMine = async () => {
    if (!wallet?.address || !selectedNode) return false;

    const mineUrl = getFakeMineUrl(wallet.address, selectedNode);
    if (!mineUrl) {
      console.warn('Could not determine fake mine URL for current node');
      return false;
    }

    // Count the mine attempt (and refresh balance) every time we mine
    setAutoMineCount(c => c + 1);
    refreshBalanceRef.current?.();

    try {
      await axios.get(mineUrl);
      return true;
    } catch (err) {
      console.log('Auto mine request completed (may have rate limits or still succeeded)');
      return false;
    }
  };

  const startAutoMining = () => {
    if (autoMineIntervalRef.current) return; // already running

    // Do one immediately using latest version
    performFakeMineRef.current?.();

    autoMineIntervalRef.current = setInterval(() => {
      performFakeMineRef.current?.();
    }, 20 * 1000); // every 20 seconds
  };

  const stopAutoMining = () => {
    if (autoMineIntervalRef.current) {
      clearInterval(autoMineIntervalRef.current);
      autoMineIntervalRef.current = null;
    }
  };

  const toggleAutoMining = () => {
    if (!wallet?.address) {
      setError('No wallet connected');
      return;
    }

    if (!isTestnetNode(selectedNode)) {
      setError('Auto mining is only available on testnet / localhost nodes');
      return;
    }

    const newState = !isAutoMining;

    if (newState) {
      // Turning ON
      setIsAutoMining(true);
      setAutoMineCount(0);
      startAutoMining();
      // Persist preference
      localStorage.setItem(`warthogAutoMine_${wallet.address.toLowerCase()}`, 'true');
    } else {
      // Turning OFF
      setIsAutoMining(false);
      stopAutoMining();
      localStorage.removeItem(`warthogAutoMine_${wallet.address.toLowerCase()}`);
    }
  };

  // Auto-stop mining if node changes to non-testnet or wallet logs out
  useEffect(() => {
    if (isAutoMining && !isTestnetNode(selectedNode)) {
      setIsAutoMining(false);
      stopAutoMining();
      if (wallet?.address) {
        localStorage.removeItem(`warthogAutoMine_${wallet.address.toLowerCase()}`);
      }
    }
  }, [selectedNode, isAutoMining]);

  // Restore auto-mining preference on login
  useEffect(() => {
    if (wallet?.address && isLoggedIn && isTestnetNode(selectedNode)) {
      const shouldMine = localStorage.getItem(`warthogAutoMine_${wallet.address.toLowerCase()}`) === 'true';
      if (shouldMine && !isAutoMining) {
        setIsAutoMining(true);
        setAutoMineCount(0);
        // small delay so node is ready
        setTimeout(() => {
          startAutoMining();
        }, 800);
      }
    }
  }, [wallet?.address, isLoggedIn, selectedNode]);

  // Cleanup interval on unmount or logout
  useEffect(() => {
    return () => {
      stopAutoMining();
    };
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !wallet) {
      stopAutoMining();
      setIsAutoMining(false);
      setAutoMineCount(0);
    }
  }, [isLoggedIn, wallet]);

  // ==================== END AUTO MINING ====================

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

  const refreshBalance = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  // Keep refs pointing to the latest function versions (prevents stale closures in setInterval)
  // These must be placed AFTER refreshBalance and performFakeMine are declared.
  useEffect(() => {
    refreshBalanceRef.current = refreshBalance;
  }, [refreshBalance]);

  useEffect(() => {
    performFakeMineRef.current = performFakeMine;
  }, [performFakeMine]);

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
    // Auto fake mining (testnet)
    isAutoMining,
    autoMineCount,
    toggleAutoMining,
    isTestnetNode,
    // Token gating helpers (pure, non-mutating)
    checkAssetBalance,
    hasAssetBalance,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};