import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

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
  const [wallet, setWallet] = useState(null);
  const [balance, setBalance] = useState(null);
  const [usdBalance, setUsdBalance] = useState(null);
  const [nextNonce, setNextNonce] = useState(null);
  const [pinHeight, setPinHeight] = useState(null);
  const [pinHash, setPinHash] = useState(null);
  const [selectedNode, setSelectedNode] = useState('');
  const [sentTransactions, setSentTransactions] = useState([]);
  const [failedTransactions, setFailedTransactions] = useState([]);
  const [error, setError] = useState(null);
  const [currentTab, setCurrentTab] = useState('overview');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // NEW: Asset balances
  const [assetBalances, setAssetBalances] = useState([]);

  const isMainnetNode = (node) => 
    node === 'https://warthognode.duckdns.org' || 
    node === 'http://217.182.64.43:3001';

  // Load initial state
  useEffect(() => {
    const savedNode = localStorage.getItem('selectedNode') || 'https://warthognode.duckdns.org';
    setSelectedNode(savedNode);

    const decryptedWallet = sessionStorage.getItem('warthogWalletDecrypted');
    if (decryptedWallet) {
      setWallet(JSON.parse(decryptedWallet));
      setIsLoggedIn(true);
      setCurrentTab('overview');
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

      // USD price
      try {
        const priceResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=warthog&vs_currencies=usd');
        const price = priceResponse.data.warthog?.usd || 0;
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
    alert('Failed to fetch asset balance. Check the hash.');
  }
};

  const refreshBalance = () => {
    setRefreshTrigger(prev => prev + 1);
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
    fetchBalanceAndNonce,
    refreshBalance,
    // NEW
    assetBalances,
    fetchAssetBalance,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};