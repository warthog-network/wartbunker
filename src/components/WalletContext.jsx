import React, { createContext, useContext, useState, useEffect, useLayoutEffect } from 'react';
import axios from 'axios';
import { encryptWallet, decryptWallet, getCleanWallet } from '../utils/warthogWalletUtils';

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
  // getCleanWallet (imported from utils) guarantees that the live 'wallet' object
  // never contains a mnemonic. Mnemonic is confined to the one-time creation backup modal (Option 2).
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

  // ==================== SECURE SIGNER (isolated Web Worker) ====================
  // The raw private key lives ONLY inside the worker after handoff.
  // Main thread (this context + all components) only ever sees address + publicKey.
  // sessionStorage only ever stores the safe "view" wallet (no privateKey).
  const signerWorkerRef = React.useRef(null);
  const pendingRequestsRef = React.useRef(new Map()); // requestId -> {resolve, reject}
  const nextRequestIdRef = React.useRef(0);

  const [hasSigningKey, setHasSigningKey] = useState(false);

  // Auto-lock for hygiene + to emphasize that "Use Now" sessions are disposable.
  const AUTO_LOCK_MS = 10 * 60 * 1000; // 10 minutes of inactivity
  const autoLockTimerRef = React.useRef(null);
  const lastActivityRef = React.useRef(Date.now());

  const resetAutoLockTimer = () => {
    lastActivityRef.current = Date.now();
    if (autoLockTimerRef.current) clearTimeout(autoLockTimerRef.current);
    if (!hasSigningKey) return;
    autoLockTimerRef.current = setTimeout(() => {
      console.info('[Wallet] Auto-locking due to inactivity (10 min)');
      performLock();
    }, AUTO_LOCK_MS);
  };

  const clearAutoLockTimer = () => {
    if (autoLockTimerRef.current) {
      clearTimeout(autoLockTimerRef.current);
      autoLockTimerRef.current = null;
    }
  };

  // Call this on any explicit user signing action or unlock to keep the session alive.
  const bumpActivity = () => {
    if (hasSigningKey) resetAutoLockTimer();
  };

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

  // ------------------ SIGNER WORKER SETUP & COMMUNICATION ------------------
  // We create the worker once. All private key material is handed off via INIT
  // and then stays inside the worker. We only ever send hashes or messages to sign.

  // Stable ref for the current message handler so we can attach at creation time
  // and properly clean up. This avoids the previous race where the effect could
  // run before the worker was created (or miss a defensively-created worker).
  const messageHandlerRef = React.useRef(null);

  const attachMessageListener = (worker) => {
    if (!worker) return;
    // Detach any prior handler from a previous worker instance (defensive)
    if (messageHandlerRef.current && signerWorkerRef.current) {
      try { signerWorkerRef.current.removeEventListener('message', messageHandlerRef.current); } catch {}
    }
    const handleMessage = (e) => {
      const data = e.data || {};
      if (data.id != null && pendingRequestsRef.current.has(data.id)) {
        const pending = pendingRequestsRef.current.get(data.id);
        if (data.type === 'ERROR') {
          pending.reject(new Error(data.error || 'Signer error'));
        } else {
          pending.resolve(data);
        }
      }
    };
    messageHandlerRef.current = handleMessage;
    worker.addEventListener('message', handleMessage);
  };

  const callSigner = (type, payload = {}) => {
    return new Promise((resolve, reject) => {
      const worker = signerWorkerRef.current;
      if (!worker) {
        reject(new Error('Signing worker is not available'));
        return;
      }
      const id = ++nextRequestIdRef.current;
      const timeout = setTimeout(() => {
        pendingRequestsRef.current.delete(id);
        reject(new Error('Signing operation timed out'));
      }, 15000);

      pendingRequestsRef.current.set(id, {
        resolve: (data) => {
          clearTimeout(timeout);
          pendingRequestsRef.current.delete(id);
          resolve(data);
        },
        reject: (err) => {
          clearTimeout(timeout);
          pendingRequestsRef.current.delete(id);
          reject(err);
        },
      });

      worker.postMessage({ type, id, ...payload });
    });
  };

  const initializeSigningKey = async (privateKeyHex) => {
    if (!privateKeyHex || typeof privateKeyHex !== 'string' || privateKeyHex.length !== 64) {
      throw new Error('initializeSigningKey requires a 64-char hex private key');
    }
    const worker = signerWorkerRef.current;
    if (!worker) {
      // Create on demand if not present (defensive)
      createSignerWorker();
    }
    await callSigner('INIT', { privateKey: privateKeyHex });
    setHasSigningKey(true);
    resetAutoLockTimer();
  };

  const createSignerWorker = () => {
    if (typeof window === 'undefined') return;
    if (signerWorkerRef.current) return;

    const worker = new Worker(
      new URL('../workers/warthogSigner.worker.js', import.meta.url),
      { type: 'module' }
    );
    signerWorkerRef.current = worker;

    // Attach the response router immediately so INIT/SIGN/etc. promises can settle.
    // Previously this was in a separate mount effect that could run before the worker
    // existed (or never re-attach on defensive creation), causing unlock + initial
    // key handoff to time out and leave hasSigningKey=false.
    attachMessageListener(worker);

    // Optional: surface unexpected worker errors to console
    worker.addEventListener('error', (e) => {
      console.error('[SignerWorker] error:', e);
    });
  };

  // Create the worker early (after hydration is fine)
  useEffect(() => {
    createSignerWorker();
    return () => {
      const w = signerWorkerRef.current;
      const h = messageHandlerRef.current;
      if (w) {
        if (h) {
          try { w.removeEventListener('message', h); } catch {}
        }
        try { w.terminate(); } catch {}
        signerWorkerRef.current = null;
      }
      messageHandlerRef.current = null;
      clearAutoLockTimer();
    };
  }, []);

  // Client-only restore from storage. Using useLayoutEffect so state updates happen
  // synchronously before the browser paints. This guarantees the *first* render
  // (server + hydrate) always matches, avoiding hydration mismatch, while still
  // restoring the logged-in named wallet state immediately after.
  useLayoutEffect(() => {
    // Restore preferred node
    const savedNode = localStorage.getItem('selectedNode') || 'https://warthognode.duckdns.org';
    setSelectedNode(savedNode);

    // Restore active wallet session — ONLY the safe view (address + publicKey).
    // The signing key, if any, does NOT survive a refresh. User must unlock (named wallets)
    // or re-import (disposable "Use Now" sessions).
    try {
      const stored = sessionStorage.getItem('warthogWalletDecrypted');
      if (stored) {
        const parsed = JSON.parse(stored);
        // Always produce a view-only shape. getCleanWallet here is defensive;
        // we explicitly strip any privateKey that might have been written by old code.
        const view = getCleanWallet(parsed) || parsed;
        const safeView = view ? { address: view.address, publicKey: view.publicKey } : null;
        if (safeView && safeView.address) {
          setWallet(safeView);
          const name = sessionStorage.getItem('warthogCurrentWalletName') || null;
          setCurrentWalletName(name);
          setIsLoggedIn(true);
          setCurrentTab('overview');
          // We deliberately start with hasSigningKey=false. Signing power requires
          // explicit unlock or re-handoff.
          setHasSigningKey(false);
        }
      }
    } catch {
      // corrupt or missing — stay logged out
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

  // Internal lock implementation (used by lockWallet and auto-lock)
  const performLock = async () => {
    try {
      const worker = signerWorkerRef.current;
      if (worker) {
        try { await callSigner('LOCK'); } catch {}
      }
    } finally {
      setHasSigningKey(false);
      clearAutoLockTimer();

      if (!wallet) return;

      const viewOnly = {
        address: wallet.address,
        publicKey: wallet.publicKey,
      };
      setWallet(viewOnly);
      try {
        sessionStorage.setItem('warthogWalletDecrypted', JSON.stringify(viewOnly));
      } catch {}
    }
  };

  // ==================== NAMED WALLET SAVE (for tagging unsaved logins) ====================
  // When the user explicitly chooses to save a currently-unlocked disposable session,
  // we temporarily retrieve the private key from the worker (user-initiated action only),
  // encrypt it for localStorage, then continue. The key is not kept in main-thread state.
  const saveNamedWallet = async (name, password) => {
    if (!wallet || !name || !password) {
      setError('Cannot save: no active wallet or missing name/password');
      return false;
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
      setError('Wallet name is required');
      return false;
    }
    if (!hasSigningKey) {
      setError('Cannot save: no active signing key in this session');
      return false;
    }
    try {
      // Pull the key from the isolated worker for this explicit user action only.
      const keyRes = await callSigner('GET_PRIVATE_KEY');
      const pk = keyRes?.privateKey;
      if (!pk) {
        setError('Cannot save: failed to retrieve signing key from secure storage');
        return false;
      }

      const cleanForEncrypt = {
        privateKey: pk,
        publicKey: wallet.publicKey,
        address: wallet.address,
      };
      const encrypted = encryptWallet(cleanForEncrypt, password);
      localStorage.setItem(`warthogWallet_${name.trim()}`, encrypted);

      const trimmed = name.trim();
      setCurrentWalletName(trimmed);
      sessionStorage.setItem('warthogCurrentWalletName', trimmed);
      setError(null);
      return true;
    } catch (err) {
      setError('Failed to save named wallet: ' + (err?.message || err));
      return false;
    }
  };

  // ==================== LOCK WALLET ====================
  // Tells the worker to drop the private key. Persists only the safe view
  // (address + publicKey) to sessionStorage. Read-only features continue to work.
  // "Use Now" (disposable) sessions become permanently unable to sign until the
  // user re-imports the key material. Named wallets can be unlocked again with password.
  const lockWallet = () => {
    if (!wallet) return;
    if (!hasSigningKey) return;
    performLock();
  };

  // ==================== UNLOCK WALLET ====================
  // For named wallets only. Decrypts from localStorage (main thread, briefly),
  // sets the safe view wallet, hands the private key to the isolated worker,
  // then immediately forgets it in the main thread.
  const unlockWallet = async (password) => {
    if (!currentWalletName) {
      setError('No saved wallet name for this session. Log out and use "Login to Saved Wallet" instead.');
      return false;
    }
    if (!wallet?.address) {
      setError('No active wallet session to unlock.');
      return false;
    }
    const key = `warthogWallet_${currentWalletName}`;
    const encrypted = localStorage.getItem(key);
    if (!encrypted) {
      setError(`Saved data for "${currentWalletName}" not found in this browser.`);
      return false;
    }
    try {
      const decrypted = decryptWallet(encrypted, password);
      if (!decrypted || !decrypted.address) {
        throw new Error('Invalid decrypted wallet data');
      }
      if (decrypted.address.toLowerCase() !== wallet.address.toLowerCase()) {
        setError('Decrypted wallet does not match the current locked session address.');
        return false;
      }

      // Always store ONLY the safe view (no privateKey) in state and sessionStorage.
      const view = {
        address: decrypted.address,
        publicKey: decrypted.publicKey,
      };
      setWallet(view);
      sessionStorage.setItem('warthogWalletDecrypted', JSON.stringify(view));
      setError(null);

      // Hand the key off to the worker and forget it here.
      const pk = decrypted.privateKey;
      if (pk) {
        await initializeSigningKey(pk);
      }
      return true;
    } catch (err) {
      const msg = err?.message || 'Invalid password or corrupted data';
      setError('Unlock failed: ' + msg);
      return false;
    }
  };

  // Derived flag for UI: we have an identity + name but no signing key in this session.
  const isSessionLocked = !!(isLoggedIn && wallet && !hasSigningKey && currentWalletName);

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

  // Clear assets + signing key when logging out or wallet is cleared
  useEffect(() => {
    if (!isLoggedIn || !wallet) {
      setAssetBalances([]);
      setWatchedAssets([]);
      setHasSigningKey(false);
      clearAutoLockTimer();
      // Tell worker to drop any key (best effort)
      const w = signerWorkerRef.current;
      if (w) { try { w.postMessage({ type: 'LOCK' }); } catch {} }

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

  // ==================== SECURE SIGNING API (delegated to worker) ====================
  // These are the only ways the rest of the app should ever produce signatures.
  // The private key is never exposed back to the caller.

  const signHash = async (hashHex) => {
    if (!hasSigningKey) {
      throw new Error('No signing key available. Lock/refresh cleared the key or wallet is not unlocked.');
    }
    bumpActivity();
    const res = await callSigner('SIGN_HASH', { hashHex });
    return {
      r: res.r,
      s: res.s,
      v: res.v,
      signature65: res.signature65,
    };
  };

  const signMessage = async (message) => {
    if (!hasSigningKey) {
      throw new Error('No signing key available for message signing.');
    }
    bumpActivity();
    const res = await callSigner('SIGN_MESSAGE', { message });
    return res.signature;
  };

  // Expose a way for the one-time setup flows to hand a key to the worker
  // after they have already persisted the safe view. Only used by WalletSetup.
  const loadSigningKey = async (privateKeyHex) => {
    await initializeSigningKey(privateKeyHex);
  };

  // Also expose a way to explicitly get the key for the rare "save this session" flow.
  // (The worker only returns it on this call.)
  const _getPrivateKeyForSaveOnly = async () => {
    if (!hasSigningKey) return null;
    const res = await callSigner('GET_PRIVATE_KEY');
    return res?.privateKey || null;
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
    // Auto fake mining (testnet)
    isAutoMining,
    autoMineCount,
    toggleAutoMining,
    isTestnetNode,
    // Token gating helpers (pure, non-mutating)
    checkAssetBalance,
    hasAssetBalance,
    // Secure signing (private key never leaves the worker)
    hasSigningKey,
    signHash,
    signMessage,
    lockWallet,
    unlockWallet,
    isSessionLocked,
    // For setup flows only (handoff after create/import/use-now or initial named login)
    loadSigningKey,
    // Internal — used by saveNamedWallet prompt for explicit user save action
    _getPrivateKeyForSaveOnly,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};