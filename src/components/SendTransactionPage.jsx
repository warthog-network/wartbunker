import React, { useCallback, useState, useEffect } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import FormattedNumber from './FormattedNumber.jsx';
import SendAssetCard from './SendAssetCard.jsx';
import {
  createWarthogApi,
  formatSubmitResult,
  parseRecipientAddress,
  signAndSubmitTransaction,
} from '../utils/warthogClient.js';
import { DEFAULT_NODE_URL } from '../utils/presetNodes.js';

const SendTransactionPage = ({ wallet: propWallet, selectedNode: propSelectedNode }) => {
  const {
    wallet: contextWallet,
    selectedNode: contextSelectedNode,
    nextNonce,
    balance,
    refreshBalance,
    setError: setContextError,
    setCurrentTab,
    isSigningUnlocked,
    isSessionLocked,
    sendAssetPrefill,
    setSendAssetPrefill,
    isTestnetNode,
  } = useWallet();

  const wallet = propWallet || contextWallet;
  const selectedNode = propSelectedNode || contextSelectedNode || DEFAULT_NODE_URL;

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
  const [activeSendTab, setActiveSendTab] = useState('wart');

  const showSendAsset = isTestnetNode(selectedNode);

  const sendTabs = [
    { id: 'wart', label: 'Send WART' },
    { id: 'asset', label: 'Send Asset' },
  ];

  useEffect(() => {
    if (sendAssetPrefill) {
      setActiveSendTab('asset');
    }
  }, [sendAssetPrefill]);

  useEffect(() => {
    const fetchOriginId = async () => {
      if (!wallet?.address || !selectedNode) return;
      try {
        const api = await createWarthogApi(selectedNode);
        const res = await api.getAccountWartBalance(wallet.address);
        if (res.success) {
          const accountData = res.data?.account;
          if (accountData?.accountId) {
            setOriginId(accountData.accountId);
          }
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
    if (!isSigningUnlocked) {
      const msg = isSessionLocked
        ? 'Unlock your wallet to send WART'
        : 'Wallet not loaded. Please log in again.';
      setLocalError(msg);
      setContextError?.(msg);
      toast.error(msg);
      return;
    }

    setIsLoading(true);
    setResult(null);
    setLocalError(null);
    setShowRawJson(false);

    try {
      const api = await createWarthogApi(selectedNode);
      const { Address, Wart } = await import('warthog-js');

      const recipient = parseRecipientAddress(Address, toAddress);
      if (!recipient) {
        throw new Error('Invalid recipient address (expected 40 or 48 hex chars with valid checksum)');
      }

      const wartAmount = Wart.parse(amount);
      if (!wartAmount) {
        throw new Error('Invalid amount');
      }

      const { nonce, data } = await signAndSubmitTransaction(api, {
        nonceId: parseInt(nonceInput, 10) || 0,
        buildSpec: {
          type: 'TRANSFER_WART',
          recipientHex: recipient.hex,
          amount,
        },
      });

      setSentNonce(nonce);

      setResult(formatSubmitResult(data));
      refreshBalance?.();
      toast.success('Transaction sent successfully');
    } catch (err) {
      const msg = err.message || 'Failed to send';
      setLocalError(msg);
      setContextError?.(msg);
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
                <FormattedNumber value={fullDetails.data?.amount?.str || amount} variant="balance" />{' '}
                <span className="text-xs text-zinc-400 font-sans">WART</span>
              </div>
            </div>

            {/* Fee */}
            <div>
              <div className="text-[10px] text-zinc-400 mb-0.5">Fee</div>
              <div className="font-semibold text-white">
                <FormattedNumber value={signed.fee?.str || '0.00000001'} variant="balance" />{' '}
                <span className="text-xs text-zinc-400 font-sans">WART</span>
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

  const handleMaxAmount = () => {
    if (balance && balance !== '0.00000000') {
      setAmount(balance);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !isLoading && toAddress && amount) handleSend();
  };

  const clearSendAssetPrefill = useCallback(() => {
    setSendAssetPrefill(null);
  }, [setSendAssetPrefill]);

  const resolvedSendTab = showSendAsset && sendTabs.some((tab) => tab.id === activeSendTab)
    ? activeSendTab
    : 'wart';

  return (
    <section className="!p-0 !bg-transparent !border-0 !shadow-none">
      <div className="mb-5">
        <h2 className="!mb-1">Send</h2>
        <p className="text-xs text-zinc-500">
          Transfer WART{showSendAsset ? ' or assets' : ''} to another address on the connected node
        </p>
      </div>

      {showSendAsset && (
        <div className="dex-tabs flex w-full gap-1 p-1 mb-6 bg-zinc-950 border border-zinc-800 rounded-xl overflow-x-auto scrollbar-hide">
          {sendTabs.map((tab) => {
            const isActive = resolvedSendTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSendTab(tab.id)}
                className={`dex-tab-btn whitespace-nowrap${isActive ? ' dex-tab-btn--active' : ''}`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {resolvedSendTab === 'wart' && (
      <div className="bg-zinc-950 border border-zinc-700 rounded-2xl p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-white mb-0.5">Send WART</h3>
          <p className="text-xs text-zinc-500">Native WART transfer</p>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">Available balance</span>
          <span className="font-mono text-white tabular-nums">
            {balance != null ? <FormattedNumber value={balance} variant="balance" /> : '…'}{' '}
            <span className="text-[#FDB913] font-sans">WART</span>
          </span>
        </div>

        <div className="form-group !mb-0">
          <label>Recipient Address</label>
          <input
            type="text"
            value={toAddress}
            onChange={e => setToAddress(e.target.value.trim())}
            onKeyDown={handleKeyDown}
            placeholder="48-character hex address"
            className="input font-mono text-sm"
            autoComplete="off"
          />
        </div>

        <div className="form-group !mb-0">
          <div className="flex items-center justify-between gap-3 mb-1">
            <label className="!mb-0">Amount</label>
            <button
              type="button"
              onClick={handleMaxAmount}
              disabled={!balance || balance === '0.00000000'}
              className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-2 !my-1 !px-3 !py-1"
            >
              MAX
            </button>
          </div>
          <input
            type="text"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="0.00100000"
            className="input"
          />
        </div>

        <details className="group">
          <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block">▸</span>
            Advanced options (nonce, fee)
          </summary>
          <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-zinc-800">
            <div className="form-group !mb-0">
              <label className="text-sm">Fee</label>
              <input
                type="text"
                value={feeInput}
                onChange={e => setFeeInput(e.target.value)}
                placeholder="Node minimum"
                className="input text-sm"
              />
            </div>
            <div className="form-group !mb-0">
              <label className="text-sm">Nonce</label>
              <input
                type="number"
                value={nonceInput}
                onChange={e => setNonceInput(e.target.value)}
                className="input text-sm"
              />
            </div>
            <div className="col-span-2 text-[10px] text-zinc-600">
              Origin ID: <span className="font-mono text-zinc-400">{originId}</span>
            </div>
          </div>
        </details>

        <button
          onClick={handleSend}
          disabled={isLoading || !toAddress || !amount}
          className="w-full py-3.5 wallet-action-btn disabled:opacity-60 !m-0"
        >
          {isLoading ? 'Signing & Sending…' : 'Send WART'}
        </button>
      </div>
      )}

      {resolvedSendTab === 'asset' && showSendAsset && (
        <SendAssetCard
          wallet={wallet}
          selectedNode={selectedNode}
          prefill={sendAssetPrefill}
          onPrefillConsumed={clearSendAssetPrefill}
        />
      )}

      {resolvedSendTab === 'wart' && result && (
        <button
          type="button"
          onClick={() => setCurrentTab?.('history')}
          className="mt-3 w-full text-xs text-zinc-500 hover:text-[#E79300] transition-colors py-2"
        >
          View in transaction history →
        </button>
      )}

      {resolvedSendTab === 'wart' && localError && (
        <div className="error mt-4">
          <strong>Error:</strong> {localError}
        </div>
      )}

      {/* Stylized Transaction Result Card */}
      {resolvedSendTab === 'wart' && result && renderTransactionCard()}
    </section>
  );
};

export default SendTransactionPage;