import React, { useState, useEffect } from 'react';
import axios from 'axios';
import CryptoJS from 'crypto-js';
import { ethers } from 'ethers';

const API_URL = '/api/proxy';

const SendTransactionPage = ({ wallet: propWallet, selectedNode: propSelectedNode }) => {
  const [toAddr, setToAddr] = useState('');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('0.01');
  const [nonceInput, setNonceInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  // Use props or fallback to sessionStorage/localStorage
  const wallet = propWallet || (sessionStorage.getItem('warthogWalletDecrypted') ? JSON.parse(sessionStorage.getItem('warthogWalletDecrypted')) : null);
  const selectedNode = propSelectedNode || localStorage.getItem('selectedNode') || 'https://warthognode.duckdns.org';

  const fetchNextNonce = async (address) => {
    try {
      const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;
      const response = await axios.get(`${API_URL}?nodePath=account/${address}/nonce&${nodeBaseParam}`, {
        headers: { 'Cache-Control': 'no-cache' }
      });
      return response.data.nonce;
    } catch (err) {
      console.error('Error fetching nonce:', err);
      return null;
    }
  };

  const handleSendTransaction = async () => {
    if (!wallet || !toAddr || !amount || !fee) {
      setError('All fields are required');
      return;
    }
    setSending(true);
    setError(null);

    try {
      const nonce = nonceInput || (await fetchNextNonce(wallet.address)) || 0;
      const txData = {
        to: toAddr,
        amount: parseFloat(amount),
        fee: parseFloat(fee),
        nonce: nonce,
        timestamp: Math.floor(Date.now() / 1000)
      };

      const privateKey = wallet.privateKey;
      const walletSigner = new ethers.Wallet(privateKey);
      const message = JSON.stringify(txData);
      const signature = await walletSigner.signMessage(message);
      const signedTx = { ...txData, signature };

      const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;
      const response = await axios.post(`${API_URL}?nodePath=transaction&${nodeBaseParam}`, signedTx, {
        headers: { 'Content-Type': 'application/json' }
      });

      alert('Transaction sent! TxID: ' + response.data.txid);
      setToAddr('');
      setAmount('');
      setFee('0.01');
      setNonceInput('');
    } catch (err) {
      setError('Failed to send transaction: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  if (!wallet) {
    return <section><h2>Send Transaction</h2><p>Please log in to send transactions.</p></section>;
  }

  if (!wallet) {
    return <section><h2>Send Transaction</h2><p>Please log in to send transactions.</p></section>;
  }

  return (
    <section>
      <h2>Send Transaction</h2>
      <p>
        Send WART tokens to another address on the Warthog network.
      </p>
      <div className="form-group">
        <label>To Address:</label>
        <input
          type="text"
          value={toAddr}
          onChange={(e) => setToAddr(e.target.value.trim())}
          placeholder="Enter 48-character to address"
          className="input"
        />
      </div>
      <div className="form-group">
        <label>Amount (WART):</label>
        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value.trim())}
          placeholder="Enter amount in WART (e.g., 1)"
          className="input"
        />
      </div>
      <div className="form-group">
        <label>Fee (WART):</label>
        <input
          type="text"
          value={fee}
          onChange={(e) => setFee(e.target.value.trim())}
          placeholder="Enter fee in WART (minimum 0.01)"
          className="input"
        />
      </div>
      <div className="form-group">
        <label>Nonce:</label>
        <input
          type="text"
          value={nonceInput}
          onChange={(e) => setNonceInput(e.target.value.trim())}
          placeholder="Auto nonce will be used if empty"
          className="input"
        />
      </div>
      <button
        onClick={handleSendTransaction}
        disabled={sending}
      >
        {sending ? 'Sending...' : 'Send Transaction'}
      </button>
      {error && <div className="error"><p>{error}</p></div>}
    </section>
  );
};

export default SendTransactionPage;
