import React, { useEffect, useState } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import FormattedNumber from './FormattedNumber.jsx';
import SpendableBalanceDisplay from './SpendableBalanceDisplay.jsx';
import {
  amountExceedsAvailable,
  formatBalanceBreakdown,
  insufficientFreeBalanceMessage,
  isValidAssetHash,
} from '../utils/warthogFormat';
import {
  createWarthogApi,
  DEFAULT_TX_FEE,
  formatSubmitError,
  formatSubmitResult,
  normalizeAssetHash,
  signAndSubmitTransaction,
} from '../utils/warthogClient.js';
import { bumpNonceAfterSuccess, getSmartNonce } from '../utils/cancelLimitOrder.js';
import { DEFAULT_NODE_URL } from '../utils/presetNodes.js';

const emptySpendable = () => ({
  available: '',
  locked: '0',
  total: '',
  hasLocked: false,
});

const SendAssetCard = ({
  wallet: propWallet,
  selectedNode: propSelectedNode,
  prefill,
  onPrefillConsumed,
}) => {
  const {
    wallet: contextWallet,
    selectedNode: contextSelectedNode,
    suggestedTxFee,
    nextNonce,
    isSigningUnlocked,
    isSessionLocked,
  } = useWallet();

  const wallet = propWallet || contextWallet;
  const selectedNode = propSelectedNode || contextSelectedNode || DEFAULT_NODE_URL;
  const toast = useToast();

  const [assetHash, setAssetHash] = useState('');
  const [assetName, setAssetName] = useState('');
  const [spendable, setSpendable] = useState(emptySpendable);
  const [decimals, setDecimals] = useState('8');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [isLiquidity, setIsLiquidity] = useState(false);
  const [feeInput, setFeeInput] = useState(DEFAULT_TX_FEE);
  const [balanceLoading, setBalanceLoading] = useState(false);

  useEffect(() => {
    setFeeInput(suggestedTxFee);
  }, [suggestedTxFee]);
  const [nonceOverride, setNonceOverride] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!prefill) return;
    setAssetHash(prefill.hash || '');
    setAssetName(prefill.name || '');
    const available = prefill.available ?? prefill.balance ?? '';
    const locked = prefill.locked ?? '0';
    const total = prefill.total ?? prefill.balance ?? available;
    setSpendable({
      available,
      locked,
      total,
      hasLocked: parseFloat(locked || '0') > 0,
    });
    setDecimals(String(prefill.decimals ?? 8));
    setAmount('');
    onPrefillConsumed?.();
  }, [prefill, onPrefillConsumed]);

  const loadAssetBalance = async (hashRaw, { silent = false } = {}) => {
    const account = wallet?.address;
    if (!account || !selectedNode) return null;

    let hash;
    try {
      hash = normalizeAssetHash(hashRaw);
    } catch {
      hash = String(hashRaw || '').replace(/^0x/i, '').toLowerCase();
    }
    if (!isValidAssetHash(hash)) return null;

    if (!silent) setBalanceLoading(true);
    try {
      const api = await createWarthogApi(selectedNode);
      const res = await api.getAccountAssetBalance(account, hash);
      if (!res.success) throw new Error(res.error || 'Failed to fetch asset balance');

      const tokenInfo = res.data?.token || {};
      const dec = tokenInfo.decimals ?? res.data?.balance?.total?.decimals ?? (parseInt(decimals, 10) || 8);
      const breakdown = await formatBalanceBreakdown(res.data?.balance, {
        kind: 'token',
        decimals: dec,
      });

      const next = {
        available: breakdown.available,
        locked: breakdown.locked,
        total: breakdown.total,
        hasLocked: breakdown.hasLocked,
      };
      setSpendable(next);
      if (tokenInfo.name) setAssetName(tokenInfo.name);
      setDecimals(String(dec));
      return next;
    } catch (err) {
      if (!silent) toast.error(err.message || 'Could not load asset balance');
      return null;
    } finally {
      if (!silent) setBalanceLoading(false);
    }
  };

  // Live refresh when hash is complete
  useEffect(() => {
    const hash = String(assetHash || '').replace(/^0x/i, '').toLowerCase();
    if (!wallet?.address || !isValidAssetHash(hash)) return undefined;
    const t = setTimeout(() => {
      loadAssetBalance(hash, { silent: true });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fetch on hash/node/address
  }, [assetHash, wallet?.address, selectedNode]);

  const copyToClipboard = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Copied to clipboard');
    }).catch(() => toast.error('Failed to copy'));
  };

  const freeBalance = spendable.available || spendable.total || '';

  const handleMaxAmount = () => {
    if (freeBalance && freeBalance !== '0') {
      setAmount(freeBalance);
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
      // Live free-balance check — locked tokens cannot be transferred
      const live = (await loadAssetBalance(assetIdRaw, { silent: true })) || spendable;
      if (live?.available != null && amountExceedsAvailable(amountStr, live.available)) {
        const unit = assetName || 'tokens';
        const msg = insufficientFreeBalanceMessage({
          available: live.available,
          locked: live.locked,
          unit,
        });
        setAmount(live.available);
        setResult(formatSubmitError(msg));
        toast.error(msg);
        return;
      }

      const api = await createWarthogApi(selectedNode);
      const { nonce, data } = await signAndSubmitTransaction(api, {
        nonceId,
        fee: feeInput,
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
      loadAssetBalance(assetIdRaw, { silent: true });
    } catch (err) {
      console.error(err);
      let message = err.message || 'Unknown error';
      if (/insufficient\s+(token\s+)?balance/i.test(message)) {
        const live = spendable;
        if (live?.available != null) {
          message = insufficientFreeBalanceMessage({
            available: live.available,
            locked: live.locked,
            unit: assetName || 'tokens',
          });
        }
      }
      setResult(formatSubmitError(message));
      toast.error('Transfer failed: ' + message);
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

      {(assetName || freeBalance || balanceLoading) && (
        <div>
          {balanceLoading && !freeBalance ? (
            <div className="text-xs text-zinc-500">Loading balance…</div>
          ) : (
            <SpendableBalanceDisplay
              available={spendable.available || freeBalance}
              locked={spendable.locked}
              total={spendable.total || freeBalance}
              unit={assetName || 'token'}
              label="Selected asset (available)"
              layout="stack"
            />
          )}
        </div>
      )}

      <div className="form-group !mb-0">
        <label>Asset Hash (64 hex chars)</label>
        <input
          type="text"
          value={assetHash}
          onChange={(e) => setAssetHash(e.target.value.trim())}
          onBlur={() => {
            if (isValidAssetHash(assetHash)) loadAssetBalance(assetHash, { silent: true });
          }}
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
            disabled={!freeBalance || freeBalance === '0'}
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
        {spendable.hasLocked && (
          <p className="text-[10px] text-amber-400/80 mt-1.5">
            MAX uses free balance only —{' '}
            <FormattedNumber value={spendable.locked} variant="balance" className="text-amber-300" />{' '}
            {assetName || 'tokens'} locked in open orders.
          </p>
        )}
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
              inputMode="decimal"
              value={feeInput}
              onChange={(e) => setFeeInput(e.target.value)}
              placeholder={suggestedTxFee}
              className="input text-sm"
            />
          </div>
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
          <p className="col-span-2 text-[10px] text-zinc-600">
            Only override nonce if you get a duplicate nonce error.
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
