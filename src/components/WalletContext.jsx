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

  // Helper to safely extract balance string
  const getBalanceStr = (wartObj) => {
    if (!wartObj) return null;
    if (wartObj.str) return wartObj.str;
    if (wartObj.E8 !== undefined) {
      return (Number(wartObj.E8) / 100000000).toFixed(8);
    }
    return null;
  };

  // Unwrap proxy response if needed
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

      // === CHAIN HEAD ===
      const chainHeadResponse = await axios.get(`${API_URL}?nodePath=chain/head&${nodeBaseParam}`);
      let headRaw = unwrapResponse(chainHeadResponse.data);
      const chainHead = headRaw?.chainHead || headRaw;
      
      setPinHeight(chainHead?.pinHeight ?? chainHead?.height ?? null);
      setPinHash(chainHead?.pinHash ?? null);

      console.log('✅ [CHAIN HEAD]', chainHead);

      // === BALANCE ENDPOINT ===
      let balanceResponse;
      if (isMainnetNode(selectedNode)) {
        balanceResponse = await axios.get(`${API_URL}?nodePath=account/${address}/balance&${nodeBaseParam}`);
      } else {
        balanceResponse = await axios.get(`${API_URL}?nodePath=account/${address}/wart_balance&${nodeBaseParam}`);
      }

      let balRaw = unwrapResponse(balanceResponse.data);
      const data = balRaw.data || balRaw;

      console.log('✅ [BALANCE RAW]', balanceResponse.data);
      console.log('✅ [BALANCE DATA]', data);

      let balanceInWart = '0.00000000';

      if (isMainnetNode(selectedNode)) {
        if (data?.balance?.total?.str) {
          balanceInWart = data.balance.total.str;
        } else if (data?.balance?.total?.E8 !== undefined) {
          balanceInWart = (Number(data.balance.total.E8) / 100000000).toFixed(8);
        } else if (data?.balance !== undefined) {
          balanceInWart = Number(data.balance).toFixed(8);
        }
      } else {
        // Testnet / DeFi
        if (data?.wart?.total?.str) {
          balanceInWart = data.wart.total.str;
        } else if (data?.wart?.total?.E8 !== undefined) {
          balanceInWart = (Number(data.wart.total.E8) / 100000000).toFixed(8);
        } else if (data?.wart?.total) {
          balanceInWart = getBalanceStr(data.wart.total) || balanceInWart;
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
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};