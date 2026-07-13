import React, { useState, useEffect } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import FormattedNumber from './FormattedNumber.jsx';
import { useNumberDisplay } from './NumberDisplayContext.jsx';
import { createWarthogApi } from '../utils/warthogClient.js';
import { normalizeChartAssetHash } from '../utils/dexPrice.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import { DEFAULT_NODE_URL, resolveSavedNodeUrl } from '../utils/presetNodes.js';
import { readPublicSession } from '../utils/sessionWallet.js';
import {
  buildVolumePlan,
  clampRounds,
  estimateWartRequired,
  executeVolumePlan,
  fetchVolumeContext,
  summarizeVolumePlan,
} from '../utils/dexVolume.js';

const DexVolumeGeneratorTool = ({ selectedNode: propSelectedNode, wallet: propWallet }) => {

  const {
    nextNonce: contextNextNonce,
    suggestedTxFee,
    isSigningUnlocked,
    isSessionLocked,
  } = useWallet();
  const { limitOrderBuyClasses, limitOrderSellClasses } = useNumberDisplay();
  const selectedNode = propSelectedNode || (() => {
    try {
      return resolveSavedNodeUrl(localStorage.getItem('selectedNode'));
    } catch {
      return DEFAULT_NODE_URL;
    }
  })();

  const wallet = propWallet || readPublicSession();

  const toast = useToast();
  const account = wallet?.address || '';

  const [volumePlan, setVolumePlan] = useState([]);
  const [volumeContext, setVolumeContext] = useState(null);
  const [volumeLogs, setVolumeLogs] = useState([]);
  const [volumeStrategy, setVolumeStrategy] = useState('buys');
  const [volumeConfirmOpen, setVolumeConfirmOpen] = useState(false);
  const [volumeConfirmMessage, setVolumeConfirmMessage] = useState('');
  const [volumePendingRun, setVolumePendingRun] = useState(null);
  const [loading, setLoading] = useState({});

  useEffect(() => {
    import('../utils/encodeLimitPrice.js').catch(() => {});
  }, []);

  const safeStr = (v, fallback = '0') => {
    if (v == null) return fallback;
    if (typeof v === 'string') {
      const t = v.trim();
      return t || fallback;
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return fallback;
      return String(v);
    }
    if (typeof v === 'object') {
      if (v.str != null && String(v.str).trim() !== '') return String(v.str);
      if (v.E8 !== undefined) return (Number(v.E8) / 100000000).toFixed(8);
      if (v.u64 !== undefined) {
        const decimals = Number.isFinite(Number(v.decimals))
          ? Math.min(18, Math.max(0, Number(v.decimals)))
          : 8;
        try {
          const value = BigInt(v.u64);
          const divisor = 10n ** BigInt(decimals);
          const whole = value / divisor;
          const frac = value % divisor;
          if (decimals === 0) return whole.toString();
          const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
          return fracStr ? `${whole}.${fracStr}` : whole.toString();
        } catch {
          return fallback;
        }
      }
    }
    return fallback;
  };

  const getSmartNonce = () => {
    if (!wallet?.address) return contextNextNonce ?? 0;
    const stored = localStorage.getItem(`warthogNextNonce_${wallet.address}`);
    const persistentNonce = stored ? Number(stored) : 0;
    return Math.max(persistentNonce, contextNextNonce ?? 0, 0);
  };

  const updateNonceAfterSuccess = (usedNonce) => {
    if (!wallet?.address) return;
    const newNonce = Math.max(getSmartNonce(), usedNonce + 1);
    localStorage.setItem(`warthogNextNonce_${wallet.address}`, newNonce);
  };

  const readVolumeForm = () => {
    const assetRaw = document.getElementById('volumeAssetHash')?.value.trim() || '';
    const assetHash = normalizeChartAssetHash(assetRaw);
    return {
      assetHash,
      rounds: clampRounds(document.getElementById('volumeRounds')?.value || 5),
      strategy: volumeStrategy,
      buyWart: document.getElementById('volumeBuyWart')?.value.trim() || '1',
      sellAsset: document.getElementById('volumeSellAsset')?.value.trim() || '10',
      basePrice: parseFloat(document.getElementById('volumeBasePrice')?.value || '0'),
      priceStep: parseFloat(document.getElementById('volumePriceStep')?.value || '0'),
      delayMs: Math.max(0, parseInt(document.getElementById('volumeDelayMs')?.value || '1500', 10) || 0),
      fee: document.getElementById('volumeTxFee')?.value?.trim() || suggestedTxFee,
    };
  };

  const previewVolumePlan = async () => {
    const form = readVolumeForm();
    if (!form.assetHash) {
      toast.error('Asset hash must be exactly 64 hex characters');
      return;
    }
    if (!wallet?.address) {
      toast.error('Connect a wallet first');
      return;
    }

    setLoading((prev) => ({ ...prev, volumePreview: true }));
    setVolumeLogs([]);

    try {
      const api = await createWarthogApi(selectedNode);
      const ctx = await fetchVolumeContext(api, wallet.address, form.assetHash);
      setVolumeContext(ctx);

      const plan = await buildVolumePlan({
        rounds: form.rounds,
        basePrice: form.basePrice,
        priceStep: form.priceStep,
        buyWart: form.buyWart,
        sellAsset: form.sellAsset,
        strategy: form.strategy,
        decimals: ctx.decimals,
      });
      setVolumePlan(plan);
      toast.success(`Plan ready — ${plan.length} orders for ${ctx.assetName}`);
    } catch (err) {
      console.error(err);
      setVolumePlan([]);
      setVolumeContext(null);
      toast.error(err.message || 'Could not build volume plan');
    } finally {
      setLoading((prev) => ({ ...prev, volumePreview: false }));
    }
  };

  const applyPoolSpotPrice = async () => {
    const form = readVolumeForm();
    if (!form.assetHash || !wallet?.address) {
      toast.error('Enter asset hash and connect wallet');
      return;
    }
    try {
      const api = await createWarthogApi(selectedNode);
      const ctx = await fetchVolumeContext(api, wallet.address, form.assetHash);
      setVolumeContext(ctx);
      if (ctx.spotPrice == null) {
        toast.error('Pool has no liquidity — deposit first or set price manually');
        return;
      }
      const el = document.getElementById('volumeBasePrice');
      if (el) el.value = String(ctx.spotPrice);
      toast.success(`Base price set to pool spot (${ctx.spotPriceLabel} WART/${ctx.assetName})`);
    } catch (err) {
      toast.error(err.message || 'Could not read pool price');
    }
  };

  const prepareVolumeRun = async () => {
    const form = readVolumeForm();
    if (!form.assetHash) {
      throw new Error('Asset hash must be exactly 64 hex characters');
    }
    if (!wallet?.address) {
      throw new Error('Connect a wallet first');
    }

    const api = await createWarthogApi(selectedNode);
    const ctx = volumeContext?.assetHash === form.assetHash
      ? volumeContext
      : await fetchVolumeContext(api, wallet.address, form.assetHash);
    setVolumeContext(ctx);

    const plan = await buildVolumePlan({
      rounds: form.rounds,
      basePrice: form.basePrice,
      priceStep: form.priceStep,
      buyWart: form.buyWart,
      sellAsset: form.sellAsset,
      strategy: form.strategy,
      decimals: ctx.decimals,
    });
    setVolumePlan(plan);

    if (ctx.balances.wart === '0' || ctx.balances.wart === '?') {
      throw new Error('Insufficient WART balance');
    }

    return { api, form, ctx, plan };
  };

  const buildVolumeConfirmMessage = (ctx, plan, form) => {
    const feePerTx = Number(form.fee) || Number(suggestedTxFee);
    const summary = summarizeVolumePlan(plan, {
      assetBalance: Number(ctx.balances.asset) || 0,
      assetName: ctx.assetName,
      feePerTx,
    });

    const lines = [
      `Submit ${summary.submitCount} limit order${summary.submitCount !== 1 ? 's' : ''} for ${ctx.assetName}?`,
      '',
      `• ${summary.buyCount} buy order${summary.buyCount !== 1 ? 's' : ''} (~${summary.buyTotal.toFixed(2)} WART on book)`,
    ];

    if (summary.sellCount > 0) {
      if (summary.sellsSkipped > 0) {
        lines.push(`• ${summary.sellCount} sell order${summary.sellCount !== 1 ? 's' : ''} (will be skipped — no ${ctx.assetName} balance)`);
      } else {
        lines.push(`• ${summary.sellCount} sell order${summary.sellCount !== 1 ? 's' : ''} (~${summary.assetCommitted.toFixed(2)} ${ctx.assetName} on book)`);
      }
    }

    lines.push(
      '',
      `Estimated WART committed: ~${summary.buyTotal.toFixed(2)} + ~${summary.feeTotal.toFixed(2)} tx fees`,
      `Delay between orders: ${form.delayMs} ms`,
      '',
      'Orders stay on the book until matched or cancelled. Review the plan above before confirming.',
    );

    return lines.join('\n');
  };

  const requestVolumeRun = async () => {
    if (!isSigningUnlocked) {
      toast.error(isSessionLocked ? 'Unlock your wallet to run the volume generator' : 'Wallet not loaded. Please log in again.');
      return;
    }

    setLoading((prev) => ({ ...prev, volumeConfirm: true }));

    try {
      const prepared = await prepareVolumeRun();
      setVolumePendingRun(prepared);
      setVolumeConfirmMessage(buildVolumeConfirmMessage(prepared.ctx, prepared.plan, prepared.form));
      setVolumeConfirmOpen(true);
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not prepare volume run');
    } finally {
      setLoading((prev) => ({ ...prev, volumeConfirm: false }));
    }
  };

  const cancelVolumeRun = () => {
    setVolumeConfirmOpen(false);
    setVolumePendingRun(null);
    setVolumeConfirmMessage('');
  };

  const runVolumeGenerator = async () => {
    if (loading.volumeRun) return;
    if (!isSigningUnlocked || !volumePendingRun) {
      cancelVolumeRun();
      return;
    }

    const { api, form, ctx, plan } = volumePendingRun;
    setVolumeConfirmOpen(false);
    setLoading((prev) => ({ ...prev, volumeRun: true }));
    setVolumeLogs([]);

    try {
      const nonce = getSmartNonce();
      const logs = [];

      const { logs: resultLogs, nextNonce } = await executeVolumePlan({
        api,
        assetHash: ctx.assetHash,
        plan,
        decimals: ctx.decimals,
        startNonce: nonce,
        delayMs: form.delayMs,
        fee: form.fee,
        assetBalance: Number(ctx.balances.asset) || 0,
        onProgress: (entry) => {
          logs.push(entry);
          setVolumeLogs([...logs]);
        },
      });

      setVolumeLogs(resultLogs);
      if (resultLogs.some((l) => l.status === 'ok' && l.nonce != null)) {
        updateNonceAfterSuccess(nextNonce - 1);
      }

      const ok = resultLogs.filter((l) => l.status === 'ok').length;
      toast.success(`Volume run complete — ${ok}/${resultLogs.length} orders submitted`);
    } catch (err) {
      console.error(err);
      toast.error('Volume generator failed: ' + (err.message || 'Unknown error'));
    } finally {
      setVolumePendingRun(null);
      setVolumeConfirmMessage('');
      setLoading((prev) => ({ ...prev, volumeRun: false }));
    }
  };

  const volumeEstimate = volumePlan.length ? estimateWartRequired(volumePlan) : null;

  return (
    <div>
      <div className="bg-zinc-950 border border-zinc-700 rounded-2xl p-5">
        <h3 className="text-base font-semibold text-white mb-1">DEX Volume Generator</h3>
        <p className="text-sm text-zinc-400 mb-4">
          Place stepped limit orders to generate DEX match volume and price history.
          Buy orders match against pool liquidity; sell orders require asset balance in your wallet.
          Testnet only — use responsibly.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Asset Hash (64 hex, no 0x)</label>
            <input
              id="volumeAssetHash"
              placeholder="Paste asset hash for your pooled token"
              className="input font-mono text-sm"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Strategy</label>
              <select
                value={volumeStrategy}
                onChange={(e) => setVolumeStrategy(e.target.value)}
                className="input"
              >
                <option value="buys">Buys only (WART → asset, uses pool)</option>
                <option value="sells">Sells only (asset → WART)</option>
                <option value="both">Both (sell then buy each round)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Rounds (1–25)</label>
              <input id="volumeRounds" type="number" min="1" max="25" defaultValue="5" className="input" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">WART per buy order</label>
              <input id="volumeBuyWart" type="number" step="any" defaultValue="5" className="input" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Asset per sell order</label>
              <input id="volumeSellAsset" type="number" step="any" defaultValue="10" className="input" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Base price (WART/asset)</label>
              <input id="volumeBasePrice" type="number" step="any" defaultValue="0.1" className="input" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Price step per round</label>
              <input id="volumePriceStep" type="number" step="any" defaultValue="0.01" className="input" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Delay between orders (ms)</label>
              <input id="volumeDelayMs" type="number" min="0" step="100" defaultValue="1500" className="input" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Fee per order (WART)</label>
              <input key={`volumeTxFee-${selectedNode}-${suggestedTxFee}`} id="volumeTxFee" type="text" inputMode="decimal" defaultValue={suggestedTxFee} placeholder={suggestedTxFee} className="input" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={applyPoolSpotPrice}
              className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1"
            >
              Use pool spot price
            </button>
            <button
              type="button"
              onClick={previewVolumePlan}
              disabled={loading.volumePreview || !account}
              className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !px-3 !py-1"
            >
              {loading.volumePreview ? 'Loading…' : 'Preview plan'}
            </button>
            <button
              type="button"
              onClick={requestVolumeRun}
              disabled={loading.volumeRun || loading.volumeConfirm || !account}
              className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !px-3 !py-1"
            >
              {loading.volumeRun
                ? 'Submitting orders…'
                : loading.volumeConfirm
                  ? 'Preparing…'
                  : 'Run volume generator'}
            </button>
          </div>

          {volumeContext && (
            <div className="p-4 bg-zinc-900/60 border border-zinc-700 rounded-2xl text-sm space-y-1">
              <div className="font-semibold text-white">{volumeContext.assetName} market snapshot</div>
              <div className="text-zinc-300">
                Your balance: <FormattedNumber value={volumeContext.balances.wart} variant="balance" /> WART
                {' · '}
                <FormattedNumber value={volumeContext.balances.asset} variant="balance" /> {volumeContext.assetName}
              </div>
              <div className="text-zinc-400">
                Pool: <FormattedNumber value={volumeContext.pool.wart} variant="balance" /> WART /{' '}
                <FormattedNumber value={volumeContext.pool.asset} variant="balance" /> {volumeContext.assetName}
                {volumeContext.spotPriceLabel && (
                  <span> · Spot {volumeContext.spotPriceLabel} WART/{volumeContext.assetName}</span>
                )}
              </div>
              <div className="text-zinc-500 text-xs">
                Open orders on book: {volumeContext.openBuys} buys, {volumeContext.openSells} sells
              </div>
            </div>
          )}

          {volumePlan.length > 0 && (
            <div className="border border-zinc-700 rounded-2xl overflow-hidden">
              <div className="px-4 py-2 bg-zinc-900 text-sm text-zinc-300 flex justify-between items-center">
                <span>Order plan ({volumePlan.length} orders)</span>
                {volumeEstimate && (
                  <span className="text-xs text-zinc-500 font-mono">
                    ~{volumeEstimate.total.toFixed(2)} WART + fees
                  </span>
                )}
              </div>
              <div className="max-h-48 overflow-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="bg-zinc-900 text-zinc-400 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2">#</th>
                      <th className="text-left px-3 py-2">Side</th>
                      <th className="text-right px-3 py-2">Amount</th>
                      <th className="text-right px-3 py-2">Price</th>
                      <th className="text-right px-3 py-2">Limit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {volumePlan.map((step, idx) => (
                      <tr key={idx} className="border-t border-zinc-800 text-zinc-300">
                        <td className="px-3 py-1.5">{step.round}</td>
                        <td className={`px-3 py-1.5 ${step.side === 'buy' ? limitOrderBuyClasses.text : limitOrderSellClasses.text}`}>
                          {step.side}
                        </td>
                        <td className="px-3 py-1.5 text-right">{step.amount}</td>
                        <td className="px-3 py-1.5 text-right">
                          <FormattedNumber value={step.price} />
                        </td>
                        <td className="px-3 py-1.5 text-right text-zinc-500">{step.limitHex}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {volumeLogs.length > 0 && (
            <div className="border border-zinc-700 rounded-2xl overflow-hidden">
              <div className="px-4 py-2 bg-zinc-900 text-sm text-zinc-300">Execution log</div>
              <ul className="max-h-40 overflow-auto text-xs font-mono p-3 space-y-1">
                {volumeLogs.map((log, idx) => (
                  <li
                    key={idx}
                    className={
                      log.status === 'ok'
                        ? 'text-[#FDB913]'
                        : log.status === 'skipped'
                          ? 'text-zinc-500'
                          : 'text-red-400'
                    }
                  >
                    {log.status === 'ok' ? '✓' : log.status === 'skipped' ? '○' : '✗'}
                    {' '}
                    {log.side} #{log.round} @ <FormattedNumber value={log.price} />
                    {log.message ? ` — ${log.message}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!account && (
            <p className="text-sm text-zinc-500 italic">
              Unlock your wallet to preview or submit volume orders.
            </p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={volumeConfirmOpen}
        title="Confirm volume generator"
        message={volumeConfirmMessage}
        confirmText={loading.volumeRun ? 'Submitting…' : 'Submit orders'}
        cancelText="Cancel"
        confirmVariant="danger"
        onConfirm={runVolumeGenerator}
        onCancel={cancelVolumeRun}
      />
    </div>
  );
};

export default DexVolumeGeneratorTool;