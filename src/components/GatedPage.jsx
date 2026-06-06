import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ethers } from 'ethers';
import { useWallet } from './WalletContext';

/**
 * GatedPage — Server-enforced token-gated content demo.
 *
 * Protected content is only revealed after:
 *   1. A cryptographic signature proves the user controls the wallet.
 *   2. The server performs an authoritative on-chain balance check for the asset.
 *
 * The actual secret / premium content lives on the server and is never present
 * in the client bundle until the gate passes.
 */
const GatedPage = () => {
  const { wallet, selectedNode, currentWalletName, isSessionLocked } = useWallet();

  const API_URL = '/api/proxy';

  // Example hardcoded token used for the server-verified gate demo.
  // Only content delivered after a successful signature + server balance check is shown.
  const EXAMPLE_ASSET_HASH = 'b92b88491b478c22fbc5b3f03f8b5539555ff2680944a8c847a1eb90ef69894e';
  const EXAMPLE_MIN = '1';

  // Fetched metadata for the example asset (for friendly name display)
  const [exampleAssetMeta, setExampleAssetMeta] = useState(null);

  // Lookup asset metadata by hash (re-uses the same endpoint the Assets tab uses)
  const lookupAsset = async (hash, node) => {
    if (!hash || !node) return null;
    const clean = hash.toLowerCase().replace(/^0x/, '');
    try {
      const nodeBaseParam = `nodeBase=${encodeURIComponent(node)}`;
      const res = await axios.get(`${API_URL}?nodePath=asset/lookup/${encodeURIComponent(clean)}&${nodeBaseParam}`);
      if (res.data?.code === 0 && res.data?.data) {
        return res.data.data;
      }
      return null;
    } catch {
      return null;
    }
  };

  // Fetch metadata for the example asset whenever the node changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const meta = await lookupAsset(EXAMPLE_ASSET_HASH, selectedNode);
      if (!cancelled) setExampleAssetMeta(meta);
    })();
    return () => { cancelled = true; };
  }, [selectedNode]);

  // ==================== SERVER-SIDE TOKEN GATE (Netlify Function) ====================
  const [serverSecret, setServerSecret] = useState(null);
  const [serverError, setServerError] = useState(null);
  const [serverLoading, setServerLoading] = useState(false);

  const fetchServerSecret = async () => {
    if (!wallet?.address) {
      setServerError('Please log in first');
      return;
    }
    if (!wallet.privateKey) {
      setServerError('Wallet private key not available for signing');
      return;
    }

    setServerLoading(true);
    setServerError(null);
    setServerSecret(null);

    try {
      const message = `Unlock server-gated secret for asset ${EXAMPLE_ASSET_HASH} as ${wallet.address} at ${Date.now()}`;
      const signer = new ethers.Wallet(wallet.privateKey);
      const signature = await signer.signMessage(message);

      const payload = {
        address: wallet.address,
        assetHash: EXAMPLE_ASSET_HASH,
        minBalance: EXAMPLE_MIN,
        nodeBase: selectedNode,
        message,
        signature,
      };

      const res = await fetch('/api/verify-token-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data.success) {
        setServerSecret(data);
      } else {
        setServerError(data.error || 'Access denied by server');
      }
    } catch (e) {
      setServerError('Failed to contact server: ' + e.message);
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

      {/* Asset under gate */}
      <div className="rounded-2xl border border-zinc-700 bg-zinc-950 p-4 text-sm">
        <div className="text-[10px] text-zinc-500">Gated asset</div>
        <div className="font-mono text-orange-400 break-all mt-0.5">{EXAMPLE_ASSET_HASH}</div>
        {exampleAssetMeta?.name && (
          <div className="text-emerald-400 text-xs mt-0.5">Name on node: {exampleAssetMeta.name}</div>
        )}
        <div className="text-zinc-400 mt-1">Minimum balance required: {EXAMPLE_MIN}</div>
      </div>

      {/* Signature-gated unlock */}
      <section className="border border-emerald-800/60 rounded-3xl p-6 bg-emerald-950/10">
        <div className="mb-4">
          <div className="font-semibold text-lg">Server-Verified Unlock</div>
          <p className="text-sm text-zinc-400 mt-1">
            Click below to sign a message with your wallet. The server will verify the signature (proof of key control)
            and re-query the Warthog node for your current on-chain balance. Only then is the protected content returned.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={fetchServerSecret}
            disabled={serverLoading || !wallet?.address || !wallet?.privateKey}
            className="px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold"
          >
            {serverLoading ? 'Verifying with server...' : 'Unlock Protected Content (sign & verify)'}
          </button>

          {(serverSecret || serverError) && (
            <button onClick={clearServerResult} className="text-xs px-3 py-2 text-zinc-400 hover:text-white">
              Clear
            </button>
          )}
        </div>

        {/* Helpful note when the session is locked but could be unlocked with a password */}
        {!wallet?.privateKey && currentWalletName && (
          <div className="mt-2 text-[11px] text-emerald-400/80">
            Wallet is currently locked (no private key in this session). Use the <span className="font-semibold">🔓 Unlock</span> button in the top bar and enter the password for "{currentWalletName}" to enable signing for gated content.
          </div>
        )}
        {!wallet?.privateKey && !currentWalletName && wallet?.address && (
          <div className="mt-2 text-[11px] text-amber-400/80">
            This session has no private key. Log out and reload your wallet (from file or saved name + password) to sign for server-gated verification.
          </div>
        )}

        <div className="mt-2 text-[11px] text-emerald-400/80">
          Requires a valid signature from your wallet’s private key. The secret never exists in the client bundle.
        </div>

        {/* Server error */}
        {serverError && (
          <div className="mt-5 rounded-2xl border border-red-700/60 bg-red-950/30 p-4 text-sm">
            <div className="text-red-400 font-semibold">Server denied access</div>
            <div className="mt-1 text-red-300">{serverError}</div>
          </div>
        )}

        {/* SUCCESS — only rendered after signature + server balance check passes */}
        {serverSecret && (
          <div className="mt-6">
            <div className="rounded-3xl border border-emerald-700/50 bg-emerald-950/30 p-8">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🔓</span>
                <span className="text-xs uppercase tracking-[1px] text-emerald-400 font-semibold">Token Gate Passed — Content Unlocked</span>
              </div>

              <div className="mb-4 text-2xl">🎉 Welcome, token holder!</div>

              <p className="text-emerald-200/90">
                This entire section is only visible because the server verified your signature and confirmed your wallet holds at least {EXAMPLE_MIN} unit of{' '}
                <span className="font-semibold text-white">
                  {exampleAssetMeta?.name ? exampleAssetMeta.name : 'this asset'}
                </span>.
              </p>

              <div className="mt-1 text-[11px] text-emerald-400/70 font-mono break-all">
                Asset hash: {EXAMPLE_ASSET_HASH}
                <button
                  onClick={() => navigator.clipboard.writeText(EXAMPLE_ASSET_HASH)}
                  className="ml-2 text-emerald-300 hover:text-white underline"
                >
                  copy
                </button>
              </div>

              {/* Perks (now only shown after real server + signature gate) */}
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-zinc-950 border border-zinc-800 p-5">
                  <div className="text-xs uppercase tracking-widest text-zinc-500 mb-2">Secret Club Perk #1</div>
                  <div className="text-lg font-semibold">Early access to new features</div>
                  <p className="mt-2 text-sm text-zinc-400">You get to try experimental tabs before they roll out to everyone.</p>
                </div>
                <div className="rounded-2xl bg-zinc-950 border border-zinc-800 p-5">
                  <div className="text-xs uppercase tracking-widest text-zinc-500 mb-2">Secret Club Perk #2</div>
                  <div className="text-lg font-semibold">Private Discord / group chat</div>
                  <p className="mt-2 text-sm text-zinc-400">A place for serious holders and builders on Warthog.</p>
                </div>
              </div>

              {/* Server-delivered secret payload */}
              <div className="mt-6 rounded-xl bg-black/40 border border-emerald-800/60 p-4">
                <div className="text-[10px] uppercase tracking-widest text-emerald-400/80 mb-2">Server-delivered content</div>
                <pre className="whitespace-pre-wrap text-sm text-emerald-100">{serverSecret.secret}</pre>
                <div className="mt-3 text-[10px] text-emerald-400/70">
                  Served at {serverSecret.servedAt} • On-chain balance reported by server: {serverSecret.balance}
                </div>
              </div>
            </div>

            <div className="mt-2 text-[10px] text-emerald-400/70 px-1">
              This UI only appears after the server accepted a valid signature and performed its own on-chain balance check.
            </div>
          </div>
        )}
      </section>

      {/* Why this matters */}
      <div className="text-xs bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-zinc-400">
        <div className="font-semibold text-zinc-300 mb-1">Why a signature + server check is required</div>
        <p>
          A client-only balance check can be bypassed by inspecting the bundle or editing local state.
          Here the protected text and perks are never sent to the browser until the server has:
        </p>
        <ul className="list-disc list-inside mt-1 space-y-0.5">
          <li>Verified a fresh cryptographic signature proving you control the private key for the address</li>
          <li>Queried the Warthog node itself for the current asset balance of that address</li>
        </ul>
        <p className="mt-1">Unsigned or low-balance requests are rejected before any secret data leaves the server.</p>
      </div>

      {/* How to use for your own gated content */}
      <section className="text-xs text-zinc-400 leading-relaxed border-l-2 border-zinc-800 pl-4">
        <div className="font-semibold text-zinc-300 mb-1">How to gate your own content</div>
        <ol className="list-decimal list-inside space-y-1">
          <li>Create an asset on Warthog and note its 64-character asset hash.</li>
          <li>On your backend (Netlify Function, API route, etc.), require a signed message from the caller.</li>
          <li>Have the server verify the signature and query the node for the address balance of the asset (e.g. <code className="text-orange-400">account/{'{'}addr{'}'}/balance/asset:{'{'}hash{'}'}</code>).</li>
          <li>Only return sensitive data (download links, keys, member content, etc.) when the on-chain balance meets your threshold.</li>
        </ol>
        <p className="mt-2">
          The example above (and the <code className="text-orange-400">/api/verify-token-gate</code> route) shows the full pattern: sign on the client, verify + re-check on the server.
        </p>
      </section>
    </div>
  );
};

export default GatedPage;
