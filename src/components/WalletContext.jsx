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

  const fetchBalanceAndNonce = async (address) => {
    setError(null);
    setBalance(null);
    setNextNonce(null);

    try {
      const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;

      // Chain head (works on both networks)
      const chainHeadResponse = await axios.get(`${API_URL}?nodePath=chain/head&${nodeBaseParam}`);
      const chainHeadData = chainHeadResponse.data.data || chainHeadResponse.data;
      setPinHeight(chainHeadData.pinHeight);
      setPinHash(chainHeadData.pinHash);

      // === BALANCE ENDPOINT (different per network) ===
      let balanceResponse;
      if (isMainnetNode(selectedNode)) {
        balanceResponse = await axios.get(`${API_URL}?nodePath=account/${address}/balance&${nodeBaseParam}`);
      } else {
        balanceResponse = await axios.get(`${API_URL}?nodePath=account/${address}/wart_balance&${nodeBaseParam}`);
      }

      const raw = balanceResponse.data;
      const data = raw.data || raw;   // handle both wrapped and direct responses

      console.log('✅ [BALANCE RAW]', raw);   // ← you can check this in browser console (F12)

      // FIXED: Parse the exact testnet structure you just showed
      let balanceInWart = '0.00000000';
      if (data?.balance?.total?.str) {
        balanceInWart = data.balance.total.str;                    // ← this is the one you have
      } else if (data?.balance?.total?.E8 !== undefined) {
        balanceInWart = (Number(data.balance.total.E8) / 100000000).toFixed(8);
      } else if (data?.balance !== undefined) {
        balanceInWart = Number(data.balance).toFixed(8);
      } else if (data?.wart_balance !== undefined) {
        balanceInWart = Number(data.wart_balance).toFixed(8);
      }

      setBalance(balanceInWart);

      // USD price (independent of node)
      try {
        const priceResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=warthog&vs_currencies=usd');
        const price = priceResponse.data.warthog?.usd || 0;
        setUsdBalance((parseFloat(balanceInWart) * price).toFixed(2));
      } catch {
        setUsdBalance('N/A');
      }

      // Nonce (mainnet only for now)
      if (isMainnetNode(selectedNode) && data?.nonceId !== undefined) {
        setNextNonce(Number(data.nonceId) + 1);
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
