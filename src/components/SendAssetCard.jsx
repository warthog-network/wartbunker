import React, { useEffect, useState } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import FormattedNumber from './FormattedNumber.jsx';
import { isValidAssetHash } from '../utils/warthogFormat';
import {
  createWarthogApi,
  formatSubmitError,
  formatSubmitResult,
  signAndSubmitTransaction,
} from '../utils/warthogClient.js';
import { bumpNonceAfterSuccess, getSmartNonce } from '../utils/cancelLimitOrder.js';
import { DEFAULT_NODE_URL } from '../utils/presetNodes.js';

const SendAssetCard = ({
  wallet: propWallet,
  selectedNode: propSelectedNode,
  prefill,
  onPrefillConsumed,
}) => {
  const {
    wallet: contextWallet,
    selectedNode: contextSelectedNode,
    nextNonce,
    isSigningUnlocked,
    isSessionLocked,
  } = useWallet();

  const wallet = propWallet || contextWallet;
  const selectedNode = propSelectedNode || contextSelectedNode || DEFAULT_NODE_URL;
  const toast = useToast();

  const [assetHash, setAssetHash] = useState('');
  const [assetName, setAssetName] = useState('');
  const [assetBalance, setAssetBalance] = useState('');
  const [decimals, setDecimals] = useState('8');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [isLiquidity, setIsLiquidity] = useState(false);
  const [nonceOverride, setNonceOverride] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!prefill) return;
    setAssetHash(prefill.hash || '');
    setAssetName(prefill.name || '');
    setAssetBalance(prefill.balance || '');
    setDecimals(String(prefill.decimals ?? 8));
    setAmount('');
    onPrefillConsumed?.();
  }, [prefill, onPrefillConsumed]);

  const copyToClipboard = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Copied to clipboard');
    }).catch(() => toast.error('Failed to copy'));
  };

  const handleMaxAmount = () => {
    if (assetBalance && assetBalance !== '0') {
      setAmount(assetBalance);
    }
  };

  const handleTransfer = async () => {
    const assetIdRaw = assetHash.trim();
    const recipientRaw = recipient.trim();
    const amountStr = amount.trim();
    const decimalsNum = parseInt(decimals, 10) || 8;

    if (!assetIdRaw || !recipientRaw || !amountStr) {
      toast.error('Asset hash, recipient, and amount are required');
      return;
    }
    if (!isSigningUnlocked) {
      toast.error(isSessionLocked ? 'Unlock your wallet to send assets' : 'Wallet not loaded. Please log in again.');
      return;
    }
    if (!isValidAssetHash(assetIdRaw)) {
      toast.error('Asset hash must be exactly 64 hex characters');
      return;
    }

    let nonceId = getSmartNonce(wallet?.address, nextNonce);
    if (nonceOverride.trim() !== '') {
      const parsed = parseInt(nonceOverride, 10);
      if (!Number.isNaN(parsed)) nonceId = parsed;
    }

    setIsLoading(true);
    setResult(null);

    try {
      const api = await createWarthogApi(selectedNode);
      const { nonce, data } = await signAndSubmitTransaction(api, {
        nonceId,
        buildSpec: {
          type: 'ASSET_TRANSFER',
          assetHash: assetIdRaw,
          toAddress: recipientRaw,
          amount: amountStr,
          decimals: decimalsNum,
          isLiquidity,
        },
      });

      setResult(formatSubmitResult(data));
      bumpNonceAfterSuccess(wallet.address, nonce, nextNonce);
      setNonceOverride('');
      toast.success('Asset transfer sent — check History tab');
    } catch (err) {
      console.error(err);
      setResult(formatSubmitError(err.message || 'Unknown error'));
      toast.error('Transfer failed: ' + (err.message || 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  };

  const renderResult = () => {
    if (!result) return null;

    const isSuccess = !result.error && (result.code === undefined || result.code === 0);
    const txHash = result.data?.txHash || result.txHash || result.data?.hash || null;

    return (
      <div className={`mt-4 rounded-2xl border p-4 ${isSuccess ? 'bg-emerald-950/40 border-emerald-700' : 'bg-red-950/40 border-red-700'}`}>
        <div className={`font-semibold text-sm ${isSuccess ? 'text-emerald-400' : 'text-red-400'}`}>
          {isSuccess ? 'Asset transfer submitted' : 'Asset transfer failed'}
        </div>
        {txHash && (
          <div
            onClick={() => copyToClipboard(txHash)}
            className="mt-2 font-mono text-xs text-emerald-400 break-all cursor-pointer hover:text-emerald-300"
          >
            {txHash}
          </div>
        )}
        {result.error && <div className="mt-2 text-xs text-red-400">{result.error}</div>}
      </div>
    );
  };

  if (!wallet) return null;

  return (
    <div className="bg-zinc-950 border border-zinc-700 rounded-2xl p-5 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-white mb-0.5">Send Asset</h3>
        <p className="text-xs text-zinc-500">
          Transfer a tracked token to another Warthog address
        </p>
      </div>

      {assetName && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">Selected asset</span>
          <span className="font-mono text-white tabular-nums">
            {assetBalance ? <FormattedNumber value={assetBalance} variant="balance" /> : '…'}{' '}
            <span className="text-[#FDB913] font-sans">{assetName}</span>
          </span>
        </div>
      )}

      <div className="form-group !mb-0">
        <label>Asset Hash (64 hex chars)</label>
        <input
          type="text"
          value={assetHash}
          onChange={(e) => setAssetHash(e.target.value.trim())}
          placeholder="e.g. b92b88491b478c22fbc5b3f03f8b5539555ff2680944a8c847a1eb90ef69894e"
          className="input font-mono text-sm"
          autoComplete="off"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="form-group !mb-0">
          <label>Decimals</label>
          <input
            type="number"
            value={decimals}
            onChange={(e) => setDecimals(e.target.value)}
            className="input text-sm"
          />
        </div>
        <div className="form-group !mb-0 flex flex-col justify-end">
          <label className="flex items-center gap-2 text-sm font-normal text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={isLiquidity}
              onChange={(e) => setIsLiquidity(e.target.checked)}
              className="h-4 w-4 accent-[#FDB913]"
            />
            Liquidity token (force precision 8)
          </label>
        </div>
      </div>

      <div className="form-group !mb-0">
        <label>Recipient Address</label>
        <input
          type="text"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value.trim())}
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
            disabled={!assetBalance || assetBalance === '0'}
            className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-2 !my-1 !px-3 !py-1"
          >
            MAX
          </button>
        </div>
        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="e.g. 1.5"
          className="input"
        />
      </div>

      <details className="group">
        <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors list-none flex items-center gap-1">
          <span className="group-open:rotate-90 transition-transform inline-block">▸</span>
          Advanced options (nonce override)
        </summary>
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <div className="form-group !mb-0">
            <label className="text-sm">Nonce override</label>
            <input
              type="number"
              value={nonceOverride}
              onChange={(e) => setNonceOverride(e.target.value)}
              placeholder="Leave empty for auto"
              className="input text-sm"
            />
          </div>
          <p className="text-[10px] text-zinc-600 mt-2">
            Only use if you get a duplicate nonce error.
          </p>
        </div>
      </details>

      <button
        type="button"
        onClick={handleTransfer}
        disabled={isLoading || !assetHash || !recipient || !amount}
        className="w-full py-3.5 wallet-action-btn disabled:opacity-60 !m-0"
      >
        {isLoading ? 'Signing & Sending…' : 'Send Asset'}
      </button>

      {renderResult()}
    </div>
  );
};

export default SendAssetCard;