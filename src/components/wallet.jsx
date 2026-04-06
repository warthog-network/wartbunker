import React, { useState, useEffect } from 'react';
import CryptoJS from 'crypto-js';
import axios from 'axios';
import { ethers } from 'ethers';
import TransactionHistory from './TransactionHistory';
import NodeSelectionPage from './NodeSelectionPage';
import SendTransactionPage from './SendTransactionPage';
import ToolsPage from './ToolsPage';
import TransactionHistoryPage from './TransactionHistoryPage';

const API_URL = '/api/proxy';
const defaultNodeList = [
  'https://warthognode.duckdns.org',
  'http://217.182.64.43:3001',
  
];

const Wallet = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [walletData, setWalletData] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [consentToClose, setConsentToClose] = useState(false);
  const [validateResult, setValidateResult] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [balance, setBalance] = useState(null);
  const [nextNonce, setNextNonce] = useState(null); // Renamed from nonceId for clarity
  const [pinHeight, setPinHeight] = useState(null);
  const [pinHash, setPinHash] = useState(null);
  const [mnemonic, setMnemonic] = useState('');
  const [privateKeyInput, setPrivateKeyInput] = useState('');
  const [address, setAddress] = useState('');
  const [toAddr, setToAddr] = useState('');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('0.01');
  const [nonceInput, setNonceInput] = useState(''); // New: for manual nonce input
  const [wordCount, setWordCount] = useState('12');
  const [pathType, setPathType] = useState('hardened');
  const [walletAction, setWalletAction] = useState('create');
  const [error, setError] = useState(null);
  const [password, setPassword] = useState('');
  const [saveWalletConsent, setSaveWalletConsent] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [isWalletProcessed, setIsWalletProcessed] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedNode, setSelectedNode] = useState(defaultNodeList[0]);
  const [showDownloadPrompt, setShowDownloadPrompt] = useState(false);
  const [sending, setSending] = useState(false); // New: to disable button during send
  const [failedTransactions, setFailedTransactions] = useState([]); // New: to log failed transactions
  const [sentTransactions, setSentTransactions] = useState([]);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showUnlockPassword, setShowUnlockPassword] = useState(false);
  const [currentTab, setCurrentTab] = useState('wallet');
  const [showDownloadPassword, setShowDownloadPassword] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [copiedTxId, setCopiedTxId] = useState(null); // New: to track copied Tx ID for feedback
  const [copiedToAddr, setCopiedToAddr] = useState(null); // New: to track copied To Address for feedback
  const [copiedFromAddr, setCopiedFromAddr] = useState(null); // New: to track copied From Address for feedback
  const [downloadPassword, setDownloadPassword] = useState('');
  const [confirmDownloadPassword, setConfirmDownloadPassword] = useState('');
  const [showConfirmDownloadPassword, setShowConfirmDownloadPassword] = useState(false);
  const [isSmallScreen767, setIsSmallScreen767] = useState(false);
  const [isSmallScreen795, setIsSmallScreen795] = useState(false);
  const [blockCounts, setBlockCounts] = useState({ '24h': 0, week: 0, month: 0, rewards24h: [], rewardsWeek: [], rewardsMonth: [] });
  const [showTooltip24h, setShowTooltip24h] = useState(false);
  const [showTooltipWeek, setShowTooltipWeek] = useState(false);
  const [showTooltipMonth, setShowTooltipMonth] = useState(false);
  const [scrollToTxid, setScrollToTxid] = useState(null);
  const [timeoutId24h, setTimeoutId24h] = useState(null);
  const [timeoutIdWeek, setTimeoutIdWeek] = useState(null);
  const [timeoutIdMonth, setTimeoutIdMonth] = useState(null);
  const [refreshHistory, setRefreshHistory] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState(null);
  const [usdBalance, setUsdBalance] = useState(null);

  // Load selectedNode from localStorage and wallet from sessionStorage on mount
  useEffect(() => {
    const savedNode = localStorage.getItem('selectedNode');
    if (savedNode && defaultNodeList.includes(savedNode)) {
      setSelectedNode(savedNode);
    }

    const decryptedWallet = sessionStorage.getItem('warthogWalletDecrypted');
    if (decryptedWallet) {
      const walletData = JSON.parse(decryptedWallet);
      setWallet(walletData);
      setIsLoggedIn(true);
      fetchBalanceAndNonce(walletData.address);
      const storedNonce = localStorage.getItem(`warthogNextNonce_${walletData.address}`);
      if (storedNonce) {
        setNextNonce(Number(storedNonce));
      }
    }
  }, []);

  const abbreviate = (str) => str ? `${str.slice(0,6)}...${str.slice(-4)}` : 'N/A';

  useEffect(() => {
    const handleResize = () => {
      setIsSmallScreen767(window.innerWidth < 767);
      setIsSmallScreen795(window.innerWidth < 795);
    };
    handleResize(); // Set initial value on mount
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  // Handle app installed event
  useEffect(() => {
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    const encryptedWallet = localStorage.getItem('warthogWallet');
    if (encryptedWallet) {
      setShowPasswordPrompt(true);
    }
  }, []);

  useEffect(() => {
    if (wallet?.address) {
      console.log('Fetching balance for address:', wallet.address);
      fetchBalanceAndNonce(wallet.address);
      // Poll for balance update every 30 seconds
      const balanceInterval = setInterval(() => fetchBalanceAndNonce(wallet.address), 30000);
      return () => clearInterval(balanceInterval);
    }
  }, [wallet, selectedNode]);

  // Poll for transaction history update every 30 seconds
  useEffect(() => {
    if (wallet?.address) {
      const historyInterval = setInterval(() => {
        setRefreshHistory(prev => !prev);
      }, 30000);
      return () => clearInterval(historyInterval);
    }
  }, [wallet, selectedNode]);

  useEffect(() => {
    if (showModal) {
      window.alert("If you haven't backed up the information elsewhere, do not close the next window without saving or downloading your private key.");
    }
  }, [showModal]);

  // Poll for pending tx status every 30 seconds if there are pending txs
  useEffect(() => {
    if (sentTransactions.length > 0 && wallet?.address) {
      const interval = setInterval(() => {
        updateTxStatuses();
      }, 30000); // 30 seconds
      return () => clearInterval(interval);
    }
  }, [sentTransactions, wallet, selectedNode]);

  // PWA Update Logic
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        setRegistration(reg);
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                setUpdateAvailable(true);
              }
            });
          }
        });
      }).catch((error) => {
        console.error('Service Worker registration failed:', error);
      });
    }
  }, []);

  const handleUpdate = () => {
    if (registration && registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      registration.waiting.addEventListener('statechange', (e) => {
        if (e.target.state === 'activated') {
          window.location.reload();
        }
      });
    }
  };

  const wartToE8 = (wart) => {
    try {
      const num = parseFloat(wart);
      if (isNaN(num) || num <= 0) return null;
      return Math.round(num * 100000000);
    } catch {
      return null;
    }
  };

  // ==================== FIXED fetchBalanceAndNonce (only change) ====================
  const fetchBalanceAndNonce = async (address) => {
    setError(null);

    // Read the latest optimistic nonce from localStorage (survives page reload / login)
    let persistentNonce = 0;
    if (address) {
      const stored = localStorage.getItem(`warthogNextNonce_${address}`);
      if (stored) persistentNonce = Number(stored);
    }

    try {
      const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;
      console.log('Sending chain head request to:', `${API_URL}?nodePath=chain/head&${nodeBaseParam}`);
      const chainHeadResponse = await axios.get(`${API_URL}?nodePath=chain/head&${nodeBaseParam}`, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      });
      console.log('Chain head response status:', chainHeadResponse.status);
      const chainHeadData = chainHeadResponse.data.data || chainHeadResponse.data;
      console.log('Chain head response data:', chainHeadData);

      console.log('Sending balance request to:', `${API_URL}?nodePath=account/${address}/balance&${nodeBaseParam}`);
      const balanceResponse = await axios.get(`${API_URL}?nodePath=account/${address}/balance&${nodeBaseParam}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      console.log('Balance response status:', balanceResponse.status);
      const balanceData = balanceResponse.data.data || balanceResponse.data;
      console.log('Balance response data:', balanceData);

      const fetchedNonce = Number(balanceData.nonceId) || 0;

      // FIXED: always keep the highest value (persistent localStorage + on-chain + current React state)
      const newNextNonce = Math.max(persistentNonce, fetchedNonce, nextNonce || 0);

      const balanceInWart = balanceData.balance !== undefined ? (balanceData.balance / 1).toFixed(8) : '0';
      setBalance(balanceInWart);

      // Fetch USD equivalent
      if (balanceInWart && balanceInWart !== '0.00000000') {
        fetch('https://api.coingecko.com/api/v3/simple/price?ids=warthog&vs_currencies=usd')
          .then(res => res.json())
          .then(data => {
            const price = data.warthog?.usd || 0;
            const usd = (parseFloat(balanceInWart) * price).toFixed(2);
            setUsdBalance(`$${usd}`);
          })
          .catch(() => setUsdBalance('N/A'));
      } else {
        setUsdBalance('$0.00');
      }

      setNextNonce(newNextNonce);
      setPinHeight(chainHeadData.pinHeight);
      setPinHash(chainHeadData.pinHash);

      if (address) {
        localStorage.setItem(`warthogNextNonce_${address}`, newNextNonce);
      }

      console.log('Chain head data:', chainHeadData);
      return { balanceInWart, nextNonce: newNextNonce, pinHeight: chainHeadData.pinHeight, pinHash: chainHeadData.pinHash };
    } catch (err) {
      const errorMessage =
        err.response?.data?.message ||
        err.message ||
        'Could not fetch chain head or balance';
      setError(errorMessage);
      console.error('Fetch error:', err);
    }
  };
  // =================================================================================

  const updateTxStatuses = async () => {
    const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;
    const updatedTxs = await Promise.all(
      sentTransactions.map(async (tx) => {
        if (tx.status === 'confirmed') return tx;
        try {
          const response = await axios.get(`${API_URL}?nodePath=transaction/lookup/${tx.txHash}&${nodeBaseParam}`);
          const data = response.data.data?.transaction || response.data.data || response.data;
          if (data.blockHeight !== undefined && data.confirmations > 0) {
            return { ...tx, status: 'confirmed', confirmations: data.confirmations };
          }
          return tx;
        } catch {
          return tx;
        }
      })
    );
    const hadConfirmation = updatedTxs.some((tx, idx) => tx.status === 'confirmed' && sentTransactions[idx].status !== 'confirmed');
    setSentTransactions(updatedTxs);
    if (hadConfirmation) {
      fetchBalanceAndNonce(wallet.address);
      setRefreshHistory(prev => !prev);
    }
  };

  const encryptWallet = (walletData, password) => {
    const { privateKey, publicKey, address } = walletData;
    const walletToSave = { privateKey, publicKey, address };
    const encrypted = CryptoJS.AES.encrypt(JSON.stringify(walletToSave), password).toString();
    return encrypted;
  };

  const decryptWallet = (encrypted, password) => {
    try {
      const bytes = CryptoJS.AES.decrypt(encrypted, password);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      if (!decrypted) throw new Error('Invalid password');
      return JSON.parse(decrypted);
    } catch {
      throw new Error('Failed to decrypt wallet: Invalid password');
    }
  };

  const saveWallet = (walletData) => {
    if (!saveWalletConsent || !password) {
      setError('Please provide a password and consent to save the wallet');
      return false;
    }
    try {
      const encrypted = encryptWallet(walletData, password);
      localStorage.setItem('warthogWallet', encrypted);
      setWallet(walletData);
      setShowPasswordPrompt(false);
      setError(null);
      setIsWalletProcessed(true);
      setPassword('');
      setSaveWalletConsent(false);
      setIsLoggedIn(true);
      sessionStorage.setItem('warthogWalletDecrypted', JSON.stringify(walletData));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  };

  const downloadWallet = (walletData, pwd) => {
    if (!pwd) {
      setError('Please provide a password to encrypt the wallet file');
      return;
    }
    const encrypted = encryptWallet(walletData, pwd);
    const blob = new Blob([encrypted], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'warthog_wallet.txt';
    a.click();
    URL.revokeObjectURL(url);
    setIsWalletProcessed(true);
    setDownloadPassword('');
    setConfirmDownloadPassword('');
    setShowDownloadPassword(false);
    setShowConfirmDownloadPassword(false);
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) {
      setError('No file selected');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setUploadedFile(e.target.result);
    };
    reader.onerror = () => setError('Failed to read file');
    reader.readAsText(file);
  };

  const loadWallet = () => {
    if (!password) {
      setError('Please provide a password');
      return;
    }
    try {
      let encrypted;
      if (uploadedFile) {
        encrypted = uploadedFile;
      } else {
        encrypted = localStorage.getItem('warthogWallet');
        if (!encrypted) throw new Error('No wallet found in storage or file');
      }
      const decryptedWallet = decryptWallet(encrypted, password);
      setWallet(decryptedWallet);
      setNonceInput('');
      fetchBalanceAndNonce(decryptedWallet.address);
      const storedNonce = localStorage.getItem(`warthogNextNonce_${decryptedWallet.address}`);
      if (storedNonce) {
        setNextNonce(Number(storedNonce));
      }
      setShowPasswordPrompt(false);
      setUploadedFile(null);
      setError(null);
      setIsWalletProcessed(false);
      setIsLoggedIn(true);
      sessionStorage.setItem('warthogWalletDecrypted', JSON.stringify(decryptedWallet));
    } catch (err) {
      setError(err.message);
    }
  };

  const clearWallet = () => {
    localStorage.removeItem('warthogWallet');
    sessionStorage.removeItem('warthogWalletDecrypted');
    if (wallet?.address) {
      localStorage.removeItem(`warthogNextNonce_${wallet.address}`);
    }
    setWallet(null);
    setBalance(null);
    setNextNonce(null);
    setPinHeight(null);
    setPinHash(null);
    setError(null);
    setIsLoggedIn(false);
    setPassword('');
    setConfirmPassword('');
    setSaveWalletConsent(false);
    setUploadedFile(null);
    setIsWalletProcessed(false);
    setIsLoggedIn(false);
    setFailedTransactions([]); // Clear failed logs on wallet clear
    setSentTransactions([]); // Clear sent logs on wallet clear
    setNonceInput('');
    setMnemonic('');
    setPrivateKeyInput('');
    setAddress('');
    setToAddr('');
    setAmount('');
    setFee('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    setShowUnlockPassword(false);
    setShowDownloadPassword(false);
    setShowLoginPassword(false);
  };

  const generateWallet = async (wordCount, pathType) => {
    const strengthBytes = wordCount === 12 ? 16 : 32;
    const entropy = window.crypto.getRandomValues(new Uint8Array(strengthBytes));
    const mnemonicObj = ethers.Mnemonic.fromEntropy(ethers.hexlify(entropy));
    const mnemonic = mnemonicObj.phrase;
    const path = pathType === 'hardened' ? "m/44'/2070'/0'/0/0" : "m/44'/2070'/0/0/0";
    const hdWallet = ethers.HDNodeWallet.fromPhrase(mnemonic, '', path);
    const publicKey = hdWallet.publicKey.slice(2);
    const sha = ethers.sha256('0x' + publicKey).slice(2);
    const ripemd = ethers.ripemd160('0x' + sha).slice(2);
    const checksum = ethers.sha256('0x' + ripemd).slice(2, 10);
    const address = ripemd + checksum;
    return {
      mnemonic,
      wordCount,
      pathType,
      privateKey: hdWallet.privateKey.slice(2),
      publicKey,
      address,
    };
  };

  const deriveWallet = (mnemonic, wordCount, pathType) => {
    try {
      const words = mnemonic.trim().split(/\s+/);
      const expectedWordCount = Number(wordCount);
      if (words.length !== expectedWordCount) {
        throw new Error(`Invalid mnemonic: must have exactly ${expectedWordCount} words`);
      }
      const path = pathType === 'hardened' ? "m/44'/2070'/0'/0/0" : "m/44'/2070'/0/0/0";
      const hdWallet = ethers.HDNodeWallet.fromPhrase(mnemonic, '', path);
      const publicKey = hdWallet.publicKey.slice(2);
      const sha = ethers.sha256('0x' + publicKey).slice(2);
      const ripemd = ethers.ripemd160('0x' + sha).slice(2);
      const checksum = ethers.sha256('0x' + ripemd).slice(2, 10);
      const address = ripemd + checksum;
      return {
        mnemonic,
        wordCount,
        pathType,
        privateKey: hdWallet.privateKey.slice(2),
        publicKey,
        address,
      };
    } catch (err) {
      throw new Error('Invalid mnemonic');
    }
  };

  const importFromPrivateKey = (privKey) => {
    console.log('Input length:', privKey.length); // Should be 64
    console.log('Is hex:', /^[0-9a-fA-F]+$/.test(privKey)); // Should be true
    try {
      if (privKey.length !== 64) {
        throw new Error('Private key must be exactly 64 characters long');
      }
      if (!/^[0-9a-fA-F]+$/.test(privKey)) {
        throw new Error('Private key must consist of hexadecimal characters only (0-9, a-f, A-F)');
      }
      const signer = new ethers.Wallet('0x' + privKey);
      const publicKey = signer.signingKey.compressedPublicKey.slice(2);
      const sha = ethers.sha256('0x' + publicKey).slice(2);
      const ripemd = ethers.ripemd160('0x' + sha).slice(2);
      const checksum = ethers.sha256('0x' + ripemd).slice(2, 10);
      const address = ripemd + checksum;
      console.log('Derived address:', address); // For extra verification
      return {
        privateKey: privKey,
        publicKey,
        address,
      };
    } catch (err) {
      console.error('Validation error:', err.message);
      throw new Error(err.message || 'Invalid private key');
    }
  };

  const handleWalletAction = async () => {
    setError(null);
    setIsWalletProcessed(false);
    if (walletAction === 'login' && !uploadedFile) {
      setError('Please upload the warthog_wallet.txt file');
      return;
    }
    if (walletAction === 'login') {
      loadWallet();
      return;
    }
    if (walletAction === 'derive' && !mnemonic) {
      setError('Please enter a seed phrase');
      return;
    }
    if (walletAction === 'import' && !privateKeyInput) {
      setError('Please enter a private key');
      return;
    }
    if (walletAction === 'derive') {
      const words = mnemonic.trim().split(/\s+/);
      const expectedWordCount = Number(wordCount);
      if (words.length !== expectedWordCount) {
        setError(`Seed phrase must have exactly ${expectedWordCount} words`);
        return;
      }
    }
    try {
      let data;
      if (walletAction === 'create') {
        data = await generateWallet(Number(wordCount), pathType);
      } else if (walletAction === 'derive') {
        data = deriveWallet(mnemonic, Number(wordCount), pathType);
      } else if (walletAction === 'import') {
        data = importFromPrivateKey(privateKeyInput);
      }
      setWalletData(data);
      setShowModal(true);
      setConsentToClose(false);
    } catch (err) {
      const errorMessage = err.message || `Failed to ${walletAction} wallet`;
      setError(errorMessage);
      clearWallet();
      console.error(`Wallet action error:`, err);
    }
  };

  const validateAddress = (addr) => {
    if (typeof addr !== 'string' || addr.length !== 48) {
      return { valid: false };
    }
    const ripemdHex = addr.slice(0, 40);
    const checksumHex = addr.slice(40);
    const computedChecksum = ethers.sha256('0x' + ripemdHex).slice(2, 10);
    return { valid: computedChecksum === checksumHex };
  };

  const handleValidateAddress = () => {
    setError(null);
    setValidateResult(null);
    if (!address) {
      setError('Please enter an address');
      return;
    }
    try {
      const result = validateAddress(address);
      setValidateResult(result);
    } catch (err) {
      const errorMessage = err.message || 'Failed to validate address';
      setError(errorMessage);
      console.error('Validate error:', err);
    }
  };

  const getRoundedFeeE8 = async (feeWart) => {
    const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;
    try {
      const response = await axios.get(`${API_URL}?nodePath=tools/encode16bit/from_string/${feeWart}&${nodeBaseParam}`);
      const feeData = response.data.data || response.data;
      return feeData.roundedE8;
    } catch (err) {
      throw new Error('Failed to round fee');
    }
  };

  const handleSendTransaction = async () => {
    if (sending) return; // Prevent multiple sends
    setSending(true);
    setError(null);
   
    if (!toAddr || !amount || !fee) {
      setError('Please fill in all transaction fields');
      setSending(false);
      return;
    }
    const amountNum = parseFloat(amount);
    const feeNum = parseFloat(fee);
    if (isNaN(amountNum) || amountNum <= 0 || isNaN(feeNum) || feeNum <= 0) {
      setError('Invalid amount or fee: must be positive numbers');
      setSending(false);
      return;
    }
    const amountE8 = wartToE8(amount);
    let feeE8;
    try {
      feeE8 = await getRoundedFeeE8(fee);
    } catch {
      setError('Invalid fee or failed to round');
      setSending(false);
      return;
    }
    const txPrivateKey = wallet?.privateKey;
    if (!txPrivateKey) {
      setError('No wallet saved. Please create, derive, or log in with a wallet first.');
      setSending(false);
      return;
    }
    if (nextNonce === null || pinHeight === null || pinHash === null || nonceInput === '') {
      setError('Nonce or chain head not available. Fetching latest...');
      await fetchBalanceAndNonce(wallet.address); // Fetch fresh if missing or auto-calculating
    }
    if (nextNonce === null || pinHeight === null || pinHash === null) {
      setError('Failed to fetch nonce or chain head. Please try again.');
      setSending(false);
      return;
    }
    let txNonce = nextNonce;
    if (nonceInput !== '') {
      const parsedNonce = Number(nonceInput);
      if (isNaN(parsedNonce) || parsedNonce < 0 || !Number.isInteger(parsedNonce)) {
        setError('Invalid nonce: must be a non-negative integer');
        setSending(false);
        return;
      }
      txNonce = parsedNonce;
    }
    // Capture transaction details for logging if failed
    const txDetails = {
      toAddr,
      amount,
      fee,
      nonce: txNonce,
      timestamp: new Date().toISOString(),
    };
    try {
      // Use current state values
      const pinHashBytes = ethers.getBytes('0x' + pinHash);
      const heightBytes = new Uint8Array(4);
      new DataView(heightBytes.buffer).setUint32(0, pinHeight, false);
      const nonceBytes = new Uint8Array(4);
      new DataView(nonceBytes.buffer).setUint32(0, txNonce, false); // Use txNonce
      const reserved = new Uint8Array(3);
      const feeBytes = new Uint8Array(8);
      new DataView(feeBytes.buffer).setBigUint64(0, BigInt(feeE8), false);
      const toRawBytes = ethers.getBytes('0x' + toAddr.slice(0, 40));
      const amountBytes = new Uint8Array(8);
      new DataView(amountBytes.buffer).setBigUint64(0, BigInt(amountE8), false);
      const messageBytes = ethers.concat([
        pinHashBytes,
        heightBytes,
        nonceBytes,
        reserved,
        feeBytes,
        toRawBytes,
        amountBytes,
      ]);
      const txHash = ethers.sha256(messageBytes);
      const txHashBytes = ethers.getBytes(txHash);
      const signer = new ethers.Wallet('0x' + txPrivateKey);
      const sig = signer.signingKey.sign(txHashBytes);
      const rHex = sig.r.slice(2);
      const sHex = sig.s.slice(2);
      const recid = sig.v - 27;
      const recidHex = recid.toString(16).padStart(2, '0');
      const signature65 = rHex + sHex + recidHex;
      const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;
      console.log('Sending transaction request to:', `${API_URL}?nodePath=transaction/add&${nodeBaseParam}`);
      const response = await axios.post(
        `${API_URL}?nodePath=transaction/add&${nodeBaseParam}`,
        {
          pinHeight,
          nonceId: txNonce, // Use txNonce
          toAddr,
          amountE8,
          feeE8,
          signature65,
        },
        { headers: { 'Content-Type': 'application/json' } }
      );
      console.log('Send transaction response status:', response.status);
      const data = response.data;
      console.log('Send transaction response data:', data);
      if (data.error || (data.code && data.code !== 0)) {
        throw new Error(data.error || `Transaction error code: ${data.code}`);
      }
      
      // Optimistic updates on success
      const newNextNonce = Math.max(nextNonce || 0, txNonce + 1);
      setNextNonce(newNextNonce);
      if (wallet?.address) {
        localStorage.setItem(`warthogNextNonce_${wallet.address}`, newNextNonce);
      }
      setBalance((parseFloat(balance) - amountNum - feeNum).toFixed(8));
      // Step 2 insertion: Log successful sent transaction as pending
      setSentTransactions((prev) => [
        ...prev,
        { ...txDetails, txHash: data.data.txHash, status: 'pending' },
      ]);
      // Clear input fields
      setToAddr('');
      setAmount('');
      setFee('');
      setNonceInput('');
    } catch (err) {
      const errorMessage =
        err.response?.data?.message ||
        err.message ||
        'Failed to send transaction';
      setError(errorMessage);
      console.error('Fetch send transaction error:', err);
      // Log the failed transaction
      setFailedTransactions((prev) => [
        ...prev,
        { ...txDetails, error: errorMessage },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        console.log('User accepted the install prompt');
      } else {
        console.log('User dismissed the install prompt');
      }
      setDeferredPrompt(null);
    }
  };

  const copyToClipboard = (text, setter) => {
    navigator.clipboard.writeText(text).then(() => {
      setter(text); // Set to show "Copied!" feedback
      setTimeout(() => setter(null), 2000); // Reset after 2s
    }).catch(err => {
      console.error('Failed to copy: ', err);
    });
  };

  return (
    <div className="container">
      <h1>Warthog Network Defi</h1>
      <nav className="tabs">
        <button className={currentTab === 'wallet' ? 'active' : ''} onClick={() => setCurrentTab('wallet')}>Wallet</button>
        <button className={currentTab === 'node' ? 'active' : ''} onClick={() => setCurrentTab('node')}>Node</button>
        <button className={currentTab === 'send' ? 'active' : ''} onClick={() => setCurrentTab('send')}>Send</button>
        <button className={currentTab === 'history' ? 'active' : ''} onClick={() => setCurrentTab('history')}>History</button>
        <button className={currentTab === 'tools' ? 'active' : ''} onClick={() => setCurrentTab('tools')}>Tools</button>
      </nav>

      {deferredPrompt && (
        <button onClick={handleInstallClick} className="mb-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:ring-4 focus:outline-none focus:ring-green-300 transition-colors duration-200">
          Install Wallet App
        </button>
      )}

      {updateAvailable && (
        <button onClick={handleUpdate} className="mb-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:ring-4 focus:outline-none focus:ring-blue-300 transition-colors duration-200">
          Update App Available
        </button>
      )}

      {!showModal && currentTab === 'wallet' && (
        <>


          {showPasswordPrompt && !wallet && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-6 mb-6">
              <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">Unlock Wallet</h2>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Upload Wallet File (optional):</label>
                <input type="file" accept=".txt" onChange={handleFileUpload} className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Password:</label>
                <div className="relative">
                  <input
                    type={showUnlockPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password to unlock wallet"
                    className="mt-1 block w-full px-3 py-2 pr-10 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowUnlockPassword(!showUnlockPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    {showUnlockPassword ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>
              <div className="flex space-x-2">
                <button onClick={loadWallet} className="px-4 py-2 text-sm font-medium text-white bg-zinc-700 rounded-lg hover:bg-zinc-800 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200 dark:bg-zinc-600 dark:hover:bg-zinc-700 dark:focus:ring-zinc-800">Unlock Wallet</button>
                <button
                  onClick={() => {
                    setShowPasswordPrompt(false);
                    setPassword('');
                    setUploadedFile(null);
                    setShowUnlockPassword(false);
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {wallet && (
            <div className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-6 mb-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Wallet Dashboard</h2>
                <button
                  className="px-4 py-2 text-sm font-medium text-white bg-zinc-700 rounded-lg hover:bg-zinc-800 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200 dark:bg-zinc-600 dark:hover:bg-zinc-700 dark:focus:ring-zinc-800"
                  onClick={() => setShowDownloadPrompt(true)}
                >
                  Download Wallet File
                </button>
              </div>
              <div className="mb-6">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300"><strong>Address:</strong></p>
                <p
                  className="text-gray-900 dark:text-white break-all cursor-pointer font-mono"
                  onClick={() => navigator.clipboard.writeText(wallet.address).then(() => alert('Address copied to clipboard!'))}
                  title="Click to copy address"
                >
                  {wallet.address}
                </p>
              </div>
              <div className="mb-6">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300"><strong>Balance:</strong> <span className="font-semibold text-green-600 dark:text-green-400">{balance !== null ? `${balance} WART` : 'Loading...'}</span> {usdBalance && usdBalance !== '$0.00' && usdBalance !== 'N/A' ? `(${usdBalance})` : ''}</p>
              </div>
              <div className="flex flex-wrap gap-2 mb-6">
                <a href="/transaction-history" className="px-4 py-2 text-sm font-medium text-white bg-zinc-700 rounded-lg hover:bg-zinc-800 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200 dark:bg-zinc-600 dark:hover:bg-zinc-700 dark:focus:ring-zinc-800">
                  📊 Transaction History
                </a>
                <a href="/node-selection" className="px-4 py-2 text-sm font-medium text-white bg-zinc-700 rounded-lg hover:bg-zinc-800 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200 dark:bg-zinc-600 dark:hover:bg-zinc-700 dark:focus:ring-zinc-800">
                  🌐 Node Selection
                </a>
                <a href="/send-transaction" className="px-4 py-2 text-sm font-medium text-white bg-zinc-700 rounded-lg hover:bg-zinc-800 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200 dark:bg-zinc-600 dark:hover:bg-zinc-700 dark:focus:ring-zinc-800">
                  💸 Send Transaction
                </a>
                <a href="/tools" className="px-4 py-2 text-sm font-medium text-white bg-zinc-700 rounded-lg hover:bg-zinc-800 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200 dark:bg-zinc-600 dark:hover:bg-zinc-700 dark:focus:ring-zinc-800">
                  🛠️ Tools
                </a>
              </div>
              <div className="flex space-x-2 mb-4">
                <button onClick={() => fetchBalanceAndNonce(wallet.address)} className="px-4 py-2 text-sm font-medium text-white bg-zinc-700 rounded-lg hover:bg-zinc-800 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200 dark:bg-zinc-600 dark:hover:bg-zinc-700 dark:focus:ring-zinc-800">
                  Refresh Balance
                </button>
                <button onClick={clearWallet} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200">
                  Clear Wallet
                </button>
                <button onClick={() => { sessionStorage.removeItem('warthogWalletDecrypted'); setIsLoggedIn(false); setWallet(null); setBalance(null); setNextNonce(null); }} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 focus:ring-4 focus:outline-none focus:ring-red-300 transition-colors duration-200">
                  Logout
                </button>
              </div>
              <p className="text-yellow-600 dark:text-yellow-400 text-sm">
                Warning: Private key is encrypted in localStorage. Keep your password secure.
              </p>
            </div>
          )}

          {currentTab === 'node' && !showModal && <NodeSelectionPage />}

          {currentTab === 'send' && !showModal && <SendTransactionPage />}

          {currentTab === 'history' && !showModal && <TransactionHistoryPage />}

          {currentTab === 'tools' && !showModal && <ToolsPage />}

          {showDownloadPrompt && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl max-w-md w-full">
                <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">Download Wallet File</h2>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Password to Encrypt Wallet:</label>
                  <div className="relative">
                    <input
                      type={showDownloadPassword ? "text" : "password"}
                      value={downloadPassword}
                      onChange={(e) => setDownloadPassword(e.target.value)}
                      placeholder="Enter password to encrypt wallet"
                      className="mt-1 block w-full px-3 py-2 pr-10 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowDownloadPassword(!showDownloadPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                      {showDownloadPassword ? "🙈" : "👁️"}
                    </button>
                  </div>
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Confirm Password:</label>
                  <div className="relative">
                    <input
                      type={showConfirmDownloadPassword ? "text" : "password"}
                      value={confirmDownloadPassword}
                      onChange={(e) => setConfirmDownloadPassword(e.target.value)}
                      placeholder="Confirm password"
                      className="mt-1 block w-full px-3 py-2 pr-10 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmDownloadPassword(!showConfirmDownloadPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                      {showConfirmDownloadPassword ? "🙈" : "👁️"}
                    </button>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <button onClick={() => {
                    if (!downloadPassword) {
                      setError('Please provide a password to encrypt and download the wallet file');
                      return;
                    }
                    if (downloadPassword !== confirmDownloadPassword) {
                      setError('Passwords do not match');
                      return;
                    }
                    setError(null);
                    downloadWallet(wallet, downloadPassword);
                    setShowDownloadPrompt(false);
                  }} className="px-4 py-2 text-sm font-medium text-white bg-zinc-700 rounded-lg hover:bg-zinc-800 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200 dark:bg-zinc-600 dark:hover:bg-zinc-700 dark:focus:ring-zinc-800">
                    Download
                  </button>
                  <button onClick={() => { setShowDownloadPrompt(false); setDownloadPassword(''); setConfirmDownloadPassword(''); setShowDownloadPassword(false); setShowConfirmDownloadPassword(false); }} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {!isLoggedIn && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-6 mb-6">
              <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">Wallet Management</h2>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Action:</label>
                <select
                  value={walletAction}
                  onChange={(e) => {
                    setWalletAction(e.target.value);
                    setError(null);
                    setMnemonic('');
                    setPrivateKeyInput('');
                    setUploadedFile(null);
                    setPassword('');
                    setIsWalletProcessed(false);
                    setShowLoginPassword(false);
                  }}
                  className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                >
                  <option value="create">Create New Wallet</option>
                  <option value="derive">Derive Wallet from Seed Phrase</option>
                  <option value="import">Import from Private Key</option>
                  <option value="login">Login with Wallet File</option>
                </select>
              </div>
              {walletAction === 'derive' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Seed Phrase:</label>
                  <input
                    type="text"
                    value={mnemonic}
                    onChange={(e) => setMnemonic(e.target.value)}
                    placeholder="Enter 12 or 24-word seed phrase"
                    className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>
              )}
              {walletAction === 'import' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Private Key:</label>
                  <input
                    type="text"
                    value={privateKeyInput}
                    onChange={(e) => setPrivateKeyInput(e.target.value.replace(/\s/g, ''))}
                    placeholder="Enter 64-character hex private key"
                    className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>
              )}
              {walletAction === 'login' && (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Upload Wallet File (warthog_wallet.txt):</label>
                    <input
                      type="file"
                      accept=".txt"
                      onChange={handleFileUpload}
                      className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    />
                  </div>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Password:</label>
                    <div className="relative">
                      <input
                        type={showLoginPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter password to decrypt wallet"
                        className="mt-1 block w-full px-3 py-2 pr-10 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword(!showLoginPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                      >
                        {showLoginPassword ? "🙈" : "👁️"}
                      </button>
                    </div>
                  </div>
                </>
              )}
              {(walletAction === 'create' || walletAction === 'derive') && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Word Count:</label>
                  <select
                    value={wordCount}
                    onChange={(e) => setWordCount(e.target.value)}
                    className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  >
                    <option value="12">12 Words</option>
                    <option value="24">24 Words</option>
                  </select>
                </div>
              )}
              {(walletAction === 'create' || walletAction === 'derive') && wordCount === '12' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Derivation Path Type:</label>
                  <select
                    value={pathType}
                    onChange={(e) => setPathType(e.target.value)}
                    className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  >
                    <option value="hardened">Hardened (m/44'/2070'/0'/0/0)</option>
                    <option value="non-hardened">Non-Hardened (m/44'/2070'/0/0/0)</option>
                  </select>
                </div>
              )}
              <button onClick={handleWalletAction} className="px-4 py-2 text-sm font-medium text-white bg-zinc-700 rounded-lg hover:bg-zinc-800 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200 dark:bg-zinc-600 dark:hover:bg-zinc-700 dark:focus:ring-zinc-800">
                {walletAction === 'create'
                  ? 'Create Wallet'
                  : walletAction === 'derive'
                  ? 'Derive Wallet'
                  : walletAction === 'import'
                  ? 'Import Wallet'
                  : 'Login'}
              </button>
            </div>
          )}





         {isLoggedIn && sentTransactions.length > 0 && (
  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-6 mb-6">
    <div className="flex justify-between items-center mb-4">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Sent Transactions Log</h2>
      
      <div className="flex gap-3">
        <button 
          onClick={updateTxStatuses} 
          className="px-4 py-2 text-sm font-medium text-white bg-zinc-700 rounded-lg hover:bg-zinc-800 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200 dark:bg-zinc-600 dark:hover:bg-zinc-700 dark:focus:ring-zinc-800"
        >
          Refresh Status
        </button>

        {sentTransactions.some(tx => tx.status === 'confirmed') && (
          <button 
            onClick={() => setSentTransactions(prev => prev.filter(tx => tx.status === 'pending'))}
            className="px-4 py-2 text-sm font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 dark:text-red-400 dark:border-red-700 transition-colors"
          >
            Clear confirmed
          </button>
        )}
      </div>
    </div>

    <ul className="space-y-4">
      {sentTransactions.map((tx, index) => (
        <li key={index} className="bg-gray-50 dark:bg-gray-700 p-4 rounded-md border border-gray-200 dark:border-gray-600">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            <p><strong className="text-gray-700 dark:text-gray-300">Timestamp:</strong> {tx.timestamp}</p>
            
            <p>
              <strong className="text-gray-700 dark:text-gray-300">From:</strong>{' '}
              <span className="text-gray-900 dark:text-white break-all">
                {isSmallScreen767 
                  ? `${wallet.address.slice(0,6)}...${wallet.address.slice(-4)}` 
                  : wallet.address}
              </span>
            </p>

            <p>
              <strong className="text-gray-700 dark:text-gray-300">To:</strong>{' '}
              <span className="text-gray-900 dark:text-white break-all">
                {isSmallScreen767 
                  ? `${tx.toAddr.slice(0,6)}...${tx.toAddr.slice(-4)}` 
                  : tx.toAddr}
              </span>
            </p>

            <p><strong className="text-gray-700 dark:text-gray-300">Amount:</strong> {tx.amount} WART</p>
            <p><strong className="text-gray-700 dark:text-gray-300">Fee:</strong> {tx.fee} WART</p>
            <p><strong className="text-gray-700 dark:text-gray-300">Nonce:</strong> {tx.nonce}</p>

            <p>
              <strong className="text-gray-700 dark:text-gray-300">Tx Hash:</strong>{' '}
              <span 
                className="text-gray-900 dark:text-white cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 break-all"
                onClick={() => copyToClipboard(tx.txHash, setCopiedTxId)}
                title={tx.txHash}
              >
                {isSmallScreen795 
                  ? `${tx.txHash.slice(0,6)}...${tx.txHash.slice(-4)}` 
                  : tx.txHash}
                {copiedTxId === tx.txHash ? ' (Copied!)' : ''}
              </span>
            </p>

            <p>
              <strong className="text-gray-700 dark:text-gray-300">Status:</strong>{' '}
              <span className={tx.status === 'confirmed' ? 'text-green-600 dark:text-green-400 font-medium' : 'text-amber-600 dark:text-amber-400'}>
                {tx.status === 'confirmed' ? 'Confirmed (Block mined)' : 'Pending'}
              </span>
            </p>
          </div>
        </li>
      ))}
    </ul>
  </div>
)}

          {isLoggedIn && failedTransactions.length > 0 && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-6 mb-6">
              <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">Failed Transactions Log</h2>
              <ul className="space-y-4">
                {failedTransactions.map((tx, index) => (
                  <li key={index} className="bg-red-50 dark:bg-red-900 p-4 rounded-md border border-red-200 dark:border-red-700">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                      <p><strong className="text-red-700 dark:text-red-300">Timestamp:</strong> {tx.timestamp}</p>
                      <p>
                        <strong className="text-red-700 dark:text-red-300">From:</strong>{' '}
                        <span
                          className="text-gray-900 dark:text-white cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 break-all"
                          title={wallet.address}
                          onClick={() => copyToClipboard(wallet.address, setCopiedFromAddr)}
                        >
                          {isSmallScreen767 ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}` : wallet.address}
                          {copiedFromAddr === wallet.address ? ' (Copied!)' : ''}
                        </span>
                      </p>
                      <p>
                        <strong className="text-red-700 dark:text-red-300">To:</strong>{' '}
                        <span
                          className="text-gray-900 dark:text-white cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 break-all"
                          title={tx.toAddr}
                          onClick={() => copyToClipboard(tx.toAddr, setCopiedToAddr)}
                        >
                          {isSmallScreen767 ? `${tx.toAddr.slice(0, 6)}...${tx.toAddr.slice(-4)}` : tx.toAddr}
                          {copiedToAddr === tx.toAddr ? ' (Copied!)' : ''}
                        </span>
                      </p>
                      <p><strong className="text-red-700 dark:text-red-300">Amount:</strong> {tx.amount} WART</p>
                      <p><strong className="text-red-700 dark:text-red-300">Fee:</strong> {tx.fee} WART</p>
                      <p><strong className="text-red-700 dark:text-red-300">Nonce:</strong> {tx.nonce}</p>
                      <p><strong className="text-red-700 dark:text-red-300">Error:</strong> {tx.error}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 p-4 rounded-md mb-6">
              <strong>Error:</strong> {error}
            </div>
          )}
        </>
      )}

      {showModal && walletData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">Wallet Information</h2>
            <p className="text-yellow-600 dark:text-yellow-400 mb-4">
              Warning: Please write down your seed phrase (if available) and private key on a piece of paper and store them securely. Do not share them with anyone.
            </p>
            <p className="text-gray-700 dark:text-gray-300 mb-2">Options for securing your wallet:</p>
            <ul className="text-gray-700 dark:text-gray-300 mb-4 list-disc list-inside">
              <li>Save the wallet to localStorage (encrypted with your password). This allows easy access but is tied to this browser.</li>
              <li>Download the wallet as an encrypted file (warthog_wallet.txt). You can store this file securely and upload it later to login.</li>
            </ul>
            {walletData.wordCount && (
              <p className="mb-2">
                <strong className="text-gray-700 dark:text-gray-300">Word Count:</strong> {walletData.wordCount}
              </p>
            )}
            {walletData.mnemonic && (
              <div className="mb-4">
                <strong className="text-gray-700 dark:text-gray-300">Seed Phrase:</strong>
                <p className="bg-yellow-50 dark:bg-yellow-900 p-4 rounded-md mt-2 border border-yellow-200 dark:border-yellow-700">
                  <span className="text-yellow-800 dark:text-yellow-200 font-mono text-lg font-bold">{walletData.mnemonic}</span>
                </p>
              </div>
            )}
            {walletData.pathType && (
              <p className="mb-2">
                <strong className="text-gray-700 dark:text-gray-300">Path Type:</strong> {walletData.pathType}
              </p>
            )}
            <div className="mb-2">
              <strong className="text-gray-700 dark:text-gray-300">Private Key:</strong><br />
              <span className="text-gray-900 dark:text-white font-mono break-all">{walletData.privateKey}</span>
            </div>
            <div className="mb-2">
              <strong className="text-gray-700 dark:text-gray-300">Public Key:</strong><br />
              <span className="text-gray-900 dark:text-white font-mono break-all">{walletData.publicKey}</span>
            </div>
            <div className="mb-4">
              <strong className="text-gray-700 dark:text-gray-300">Address:</strong><br />
              <span className="text-gray-900 dark:text-white font-mono break-all">{walletData.address}</span>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Password to Encrypt Wallet:</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password to encrypt wallet"
                  className="mt-1 block w-full px-3 py-2 pr-10 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  {showPassword ? "🙈" : "👁️"}
                </button>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Confirm Password:</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  className="mt-1 block w-full px-3 py-2 pr-10 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  {showConfirmPassword ? "🙈" : "👁️"}
                </button>
              </div>
            </div>
            {error && (
              <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 p-4 rounded-md mb-4">
                <strong>Error:</strong> {error}
              </div>
            )}
            <div className="mb-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={saveWalletConsent}
                  onChange={(e) => setSaveWalletConsent(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                />
                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">Save wallet to localStorage (encrypted)</span>
              </label>
            </div>
            <div className="flex space-x-2 mb-4">
              <button
                onClick={() => {
                  if (!password) {
                    setError('Please provide a password to encrypt and save the wallet.');
                    return;
                  }
                  if (password !== confirmPassword) {
                    setError('Passwords do not match.');
                    return;
                  }
                  if (!saveWalletConsent) {
                    setError('Please consent to save the wallet.');
                    return;
                  }
                  setError(null);
                  saveWallet(walletData);
                  setShowModal(false);
                  setWalletData(null);
                  setPassword('');
                  setConfirmPassword('');
                  setShowPassword(false);
                  setShowConfirmPassword(false);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-zinc-700 rounded-lg hover:bg-zinc-800 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200 dark:bg-zinc-600 dark:hover:bg-zinc-700 dark:focus:ring-zinc-800"
              >
                Save Wallet
              </button>
              <button
                onClick={() => {
                  if (!password) {
                    setError('Please provide a password to encrypt and download the wallet file.');
                    return;
                  }
                  if (password !== confirmPassword) {
                    setError('Passwords do not match.');
                    return;
                  }
                  setError(null);
                  downloadWallet(walletData);
                  setShowModal(false);
                  setWalletData(null);
                  setPassword('');
                  setConfirmPassword('');
                  setShowPassword(false);
                  setShowConfirmPassword(false);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-zinc-700 rounded-lg hover:bg-zinc-800 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200 dark:bg-zinc-600 dark:hover:bg-zinc-700 dark:focus:ring-zinc-800"
              >
                Download Wallet File
              </button>
            </div>
            <div className="flex items-center justify-end space-x-2">
              <label className="flex items-center text-sm">
                <input
                  type="checkbox"
                  checked={consentToClose}
                  onChange={(e) => setConsentToClose(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                />
                <span className="ml-2 text-gray-700 dark:text-gray-300">I consent to close without saving to local storage or downloading the wallet file</span>
              </label>
              <button
                disabled={!consentToClose}
                onClick={() => {
                  setShowModal(false);
                  setWalletData(null);
                  setPassword('');
                  setConfirmPassword('');
                  setSaveWalletConsent(false);
                  setConsentToClose(false);
                  setError(null);
                  setShowPassword(false);
                  setShowConfirmPassword(false);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Wallet;
