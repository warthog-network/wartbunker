import React, { useState, useEffect } from 'react';
import { useWallet } from './WalletContext';
import { createWarthogApi } from '../utils/warthogClient.js';
import { signMessageInWorker } from '../utils/signingBridge.js';

const GatedPage = () => {
  const { wallet, selectedNode, currentWalletName, isSigningUnlocked, isSessionLocked } = useWallet();
  const EXAMPLE_ASSET_HASH = 'b846d64efa05a3bb1d81c035f97c086ebf7995083236b6ac75c44a8a7b8caa17';
  const EXAMPLE_MIN = '1';

  const [exampleAssetMeta, setExampleAssetMeta] = useState(null);
  const [serverSecret, setServerSecret] = useState(null);
  const [serverError, setServerError] = useState(null);
  const [serverLoading, setServerLoading] = useState(false);

  const lookupAsset = async (hash, node) => {
    if (!hash || !node) return null;
    const clean = hash.toLowerCase().replace(/^0x/, '');
    try {
      const api = await createWarthogApi(node);
      const res = await api.lookupAsset(clean);
      if (res.success) {
        return res.data;
      }
      return null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const meta = await lookupAsset(EXAMPLE_ASSET_HASH, selectedNode);
      if (!cancelled) setExampleAssetMeta(meta);
    })();
    return () => { cancelled = true; };
  }, [selectedNode]);

  const fetchServerSecret = async () => {
    if (!wallet?.address) {
      setServerError('Please log in first');
      return;
    }
    if (!isSigningUnlocked) {
      setServerError(isSessionLocked
        ? 'Wallet is locked — unlock with your saved wallet password to sign'
        : 'Wallet not loaded for signing');
      return;
    }

    setServerLoading(true);
    setServerError(null);
    setServerSecret(null);

    try {
      const message = `Unlock server-gated secret for asset ${EXAMPLE_ASSET_HASH} as ${wallet.address} at ${Date.now()}`;
      const signature = await signMessageInWorker(message);

      const res = await fetch('/api/verify-token-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: wallet.address,
          assetHash: EXAMPLE_ASSET_HASH,
          minBalance: EXAMPLE_MIN,
          nodeBase: selectedNode,
          message,
          signature,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setServerSecret(data);
      } else {
        setServerError(data.error || 'Access denied by server');
      }
    } catch (e) {
      setServerError(`Failed to contact server: ${e.message}`);
    } finally {
      setServerLoading(false);
    }
  };

  const clearServerResult = () => {
    setServerSecret(null);
    setServerError(null);
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Members Area</h2>
        <p className="mt-2 text-zinc-400">
          This demonstrates <span className="font-semibold text-orange-400">server-enforced token-gated content</span> on Warthog Network.
          Protected sections are only shown after a cryptographic signature proves wallet control and the server confirms on-chain balance.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-700 bg-zinc-950 p-4 text-sm">
        <div className="text-[10px] text-zinc-500">Gated asset</div>
        <div className="font-mono text-orange-400 break-all mt-0.5">{EXAMPLE_ASSET_HASH}</div>
        {exampleAssetMeta?.name && (
          <div className="text-emerald-400 text-xs mt-0.5">Name on node: {exampleAssetMeta.name}</div>
        )}
        <div className="text-zinc-400 mt-1">Minimum balance required: {EXAMPLE_MIN}</div>
      </div>

      <section className="border border-emerald-800/60 rounded-3xl p-6 bg-emerald-950/10">
        <div className="mb-4">
          <div className="font-semibold text-lg">Server-Verified Unlock</div>
          <p className="text-sm text-zinc-400 mt-1">
            Sign a message with your wallet. The server verifies the signature and re-queries the node for your on-chain balance before returning protected content.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={fetchServerSecret}
            disabled={serverLoading || !wallet?.address || !isSigningUnlocked}
            className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !px-3 !py-1"
          >
            {serverLoading ? 'Verifying with server...' : 'Unlock Protected Content (sign & verify)'}
          </button>

          {(serverSecret || serverError) && (
            <button onClick={clearServerResult} className="text-xs px-3 py-2 text-zinc-400 hover:text-white">
              Clear
            </button>
          )}
        </div>

        {!isSigningUnlocked && currentWalletName && (
          <div className="mt-2 text-[11px] text-emerald-400/80">
            Wallet is locked. Use the <span className="font-semibold">Unlock</span> button in the top bar and enter the password for &quot;{currentWalletName}&quot; to enable signing.
          </div>
        )}

        {serverError && (
          <div className="mt-5 rounded-2xl border border-red-700/60 bg-red-950/30 p-4 text-sm">
            <div className="text-red-400 font-semibold">Server denied access</div>
            <div className="mt-1 text-red-300">{serverError}</div>
          </div>
        )}

        {serverSecret && (
          <div className="mt-6">
            <div className="rounded-3xl border border-emerald-700/50 bg-emerald-950/30 p-8">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🔓</span>
                <span className="text-xs uppercase tracking-[1px] text-emerald-400 font-semibold">Token Gate Passed</span>
              </div>

              <div className="mb-4 text-2xl">Welcome, token holder!</div>

              <p className="text-emerald-200/90">
                This section is only visible because the server verified your signature and confirmed your wallet holds at least {EXAMPLE_MIN} unit of{' '}
                <span className="font-semibold text-white">
                  {exampleAssetMeta?.name ? exampleAssetMeta.name : 'this asset'}
                </span>.
              </p>

              <div className="mt-6 rounded-xl bg-black/40 border border-emerald-800/60 p-4">
                <div className="text-[10px] uppercase tracking-widest text-emerald-400/80 mb-2">Server-delivered content</div>
                <pre className="whitespace-pre-wrap text-sm text-emerald-100">{serverSecret.secret}</pre>
                <div className="mt-3 text-[10px] text-emerald-400/70">
                  Served at {serverSecret.servedAt} • On-chain balance: {serverSecret.balance}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

export default GatedPage;