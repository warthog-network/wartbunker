import React, { useState, useEffect } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import axios from 'axios';
import { ethers } from 'ethers';

const API_URL = '/api/proxy';

const SendTransactionPage = ({ wallet: propWallet, selectedNode: propSelectedNode }) => {
  const {
    wallet: contextWallet,
    selectedNode: contextSelectedNode,
    pinHeight,
    pinHash,
    nextNonce,
    refreshBalance,
    setError: setContextError,
  } = useWallet();

  const wallet = propWallet || contextWallet;
  const selectedNode = propSelectedNode || contextSelectedNode || 'https://warthognode.duckdns.org';

  const toast = useToast();

  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('0.00100000');
  const [feeInput, setFeeInput] = useState('0.0001');
  const [originId, setOriginId] = useState(0);
  const [nonceInput, setNonceInput] = useState('0');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [localError, setLocalError] = useState(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [sentNonce, setSentNonce] = useState(null); // ← NEW: Remember the nonce we actually sent

  useEffect(() => {
    const fetchOriginId = async () => {
      if (!wallet?.address || !selectedNode) return;
      try {
        const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;
        const response = await axios.get(
          `${API_URL}?nodePath=account/${wallet.address}/wart_balance&${nodeBaseParam}`
        );
        const accountData = response.data.data?.account || response.data.account;
        if (accountData?.accountId) {
          setOriginId(accountData.accountId);
        }
      } catch (err) {
        console.warn('Could not fetch originId');
        setOriginId(0);
      }
    };
    fetchOriginId();
  }, [wallet?.address, selectedNode]);

  useEffect(() => {
    if (nextNonce !== null) setNonceInput(String(nextNonce));
  }, [nextNonce]);

  const hexToBytes = (hex) => {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return bytes;
  };

  const uint32BE = (value) => {
    const buf = new Uint8Array(4);
    buf[0] = (value >>> 24) & 0xff;
    buf[1] = (value >>> 16) & 0xff;
    buf[2] = (value >>> 8) & 0xff;
    buf[3] = value & 0xff;
    return buf;
  };

  const uint64BE = (value) => {
    const buf = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) {
      buf[i] = Number(value & 0xffn);
      value >>= 8n;
    }
    return buf;
  };

  const addressToBytes = (addr) => {
    const clean = addr.startsWith('0x') ? addr.slice(2) : addr;
    return hexToBytes(clean.slice(0, 40));
  };

  const copyToClipboard = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Copied to clipboard');
    }).catch(() => toast.error('Failed to copy'));
  };

  const handleSend = async () => {
    if (!wallet || !toAddress || !amount) {
      const msg = 'Please enter To Address and Amount';
      setLocalError(msg);
      setContextError?.(msg);
      return;
    }

    setIsLoading(true);
    setResult(null);
    setLocalError(null);
    setShowRawJson(false);

    try {
      const amountNum = parseFloat(amount);
      const amountE8 = BigInt(Math.floor(amountNum * 100000000));
      const nonceId = parseInt(nonceInput) || 0;

      setSentNonce(nonceId); // ← Capture the nonce we are actually sending

      const currentPinHeight = pinHeight || 0;
      const currentPinHash = pinHash || '0000000000000000000000000000000000000000000000000000000000000000';

      const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;

      const minFeeRes = await axios.get(
        `${API_URL}?nodePath=transaction/minfee&${nodeBaseParam}`
      );
      const minFeeE8 = minFeeRes.data?.data?.minFee?.E8 || minFeeRes.data?.minFee?.E8;

      if (!minFeeE8) {
        throw new Error('Could not fetch minimum fee');
      }

      const binaryParts = [
        hexToBytes(currentPinHash),
        uint32BE(currentPinHeight),
        uint32BE(nonceId),
        new Uint8Array(3),
        uint64BE(BigInt(minFeeE8)),
        addressToBytes(toAddress.trim()),
        uint64BE(amountE8),
      ];

      const totalLength = binaryParts.reduce((sum, part) => sum + part.length, 0);
      const binary = new Uint8Array(totalLength);
      let offset = 0;
      for (const part of binaryParts) {
        binary.set(part, offset);
        offset += part.length;
      }

      const hashHex = ethers.sha256(binary);
      const hash = hashHex.slice(2);

      const signer = new ethers.Wallet(wallet.privateKey);
      const signature = await signer.signingKey.sign(ethers.getBytes('0x' + hash));

      const r = signature.r.slice(2).padStart(64, '0');
      const s = signature.s.slice(2).padStart(64, '0');
      const v = (signature.v - 27).toString(16).padStart(2, '0');
      const signature65 = r + s + v;

      const payload = {
        type: 'wartTransfer',
        pinHeight: currentPinHeight,
        nonceId: nonceId,
        feeE8: Number(minFeeE8),
        toAddr: toAddress.trim(),
        wartE8: Number(amountE8),
        signature65: signature65,
      };

      const response = await axios.post(
        `${API_URL}?nodePath=transaction/add&${nodeBaseParam}`,
        payload,
        { headers: { 'Content-Type': 'application/json' } }
      );

      const resData = response.data;
      setResult(resData);

      if (resData.code === 0 || resData.txHash || resData.data?.txHash) {
        refreshBalance?.();
        toast.success('Transaction sent successfully');
      } else {
        const errorMsg = resData.error || 'Transaction rejected by node';
        setLocalError(errorMsg);
        setContextError?.(errorMsg);
        toast.error(errorMsg);
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to send';
      setLocalError(msg);
      setContextError?.(msg);
      setResult({ error: msg });
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // ==================== STYLIZED TRANSACTION RESULT CARD ====================
  const renderTransactionCard = () => {
    if (!result) return null;

    const txHash = result.txHash || result.data?.txHash || result.fullDetails?.transaction?.hash;
    const fullDetails = result.fullDetails?.transaction || result.transaction || {};
    const signed = fullDetails.signedCommon || {};

    // Prefer nonce from response → captured sentNonce → current input
    const usedNonce = signed.nonceId ?? sentNonce ?? nonceInput;

    return (
      <div className="mt-6 bg-zinc-950 border border-zinc-700 rounded-2xl overflow-hidden text-sm">
        {/* Header */}
        <div className="px-5 py-3 bg-zinc-900 border-b border-zinc-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400"></div>
            <span className="font-semibold text-emerald-400">Transaction Sent</span>
          </div>
          <button
            onClick={() => setShowRawJson(!showRawJson)}
            className="text-xs px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
          >
            {showRawJson ? 'Hide JSON' : 'Show JSON'}
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Transaction Hash */}
          <div>
            <div className="text-[10px] text-zinc-400 mb-0.5">Transaction Hash</div>
            <div 
              onClick={() => txHash && copyToClipboard(txHash)}
              className="font-mono text-emerald-400 text-xs break-all cursor-pointer hover:text-emerald-300"
            >
              {txHash || 'Pending...'}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            {/* Amount */}
            <div>
              <div className="text-[10px] text-zinc-400 mb-0.5">Amount</div>
              <div className="font-semibold text-white">
                {fullDetails.data?.amount?.str || amount} <span className="text-xs text-zinc-400">WART</span>
              </div>
            </div>

            {/* Fee */}
            <div>
              <div className="text-[10px] text-zinc-400 mb-0.5">Fee</div>
              <div className="font-semibold text-white">
                {signed.fee?.str || '0.00000001'} <span className="text-xs text-zinc-400">WART</span>
              </div>
            </div>

            {/* To Address */}
            <div className="col-span-2">
              <div className="text-[10px] text-zinc-400 mb-0.5">To Address</div>
              <div 
                onClick={() => copyToClipboard(fullDetails.data?.toAddress || toAddress)}
                className="font-mono text-xs text-white break-all cursor-pointer hover:text-emerald-400"
              >
                {fullDetails.data?.toAddress || toAddress}
              </div>
            </div>

            {/* Nonce */}
            <div>
              <div className="text-[10px] text-zinc-400 mb-0.5">Nonce</div>
              <div className="font-mono text-white">{usedNonce}</div>
            </div>
          </div>
        </div>

        {/* Raw JSON */}
        {showRawJson && (
          <div className="border-t border-zinc-700 p-4 bg-zinc-900">
            <pre className="text-[10px] text-zinc-300 overflow-auto max-h-80">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  };

  if (!wallet) {
    return <section><h2>Send WART</h2><p>Please log in first.</p></section>;
  }

  return (
    <section>
      <h2>Send WART</h2>
      <p className="text-gray-400 text-sm mb-4">Uses WalletContext + node minimum fee</p>

      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs text-gray-400">Detected originId:</span>
        <span className="px-3 py-1 bg-emerald-900/50 text-emerald-400 font-mono text-sm rounded-full border border-emerald-700">
          {originId}
        </span>
      </div>

      <div className="form-group">
        <label>To Address (48 hex chars)</label>
        <input
          type="text"
          value={toAddress}
          onChange={e => setToAddress(e.target.value.trim())}
          placeholder="647d1f856e51968cd8eb41a139bc55306a3d1a2e9eccda69"
          className="input font-mono text-sm"
        />
      </div>

      <div className="form-group">
        <label>Amount (WART)</label>
        <input
          type="text"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="0.00100000"
          className="input"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="form-group">
          <label>Fee (WART) — auto-set to node minimum</label>
          <input
            type="text"
            value={feeInput}
            onChange={e => setFeeInput(e.target.value)}
            placeholder="0.0001"
            className="input"
          />
        </div>
        <div className="form-group">
          <label>Nonce</label>
          <input
            type="number"
            value={nonceInput}
            onChange={e => setNonceInput(e.target.value)}
            className="input"
          />
        </div>
      </div>

      <button
        onClick={handleSend}
        disabled={isLoading || !toAddress || !amount}
        className="mt-4 w-full py-3.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold rounded-2xl text-base shadow-lg shadow-orange-500/30 disabled:opacity-60 active:scale-[0.985] transition-all"
      >
        {isLoading ? 'Signing & Sending...' : 'Sign and Send WART'}
      </button>

      {localError && (
        <div className="error mt-4">
          <strong>Error:</strong> {localError}
        </div>
      )}

      {/* Stylized Transaction Result Card */}
      {result && renderTransactionCard()}
    </section>
  );
};

export default SendTransactionPage;