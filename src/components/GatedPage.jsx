import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ethers } from 'ethers';
import { useWallet } from './WalletContext';
import TokenGate, { useTokenGate } from './TokenGate';

const API_URL = '/api/proxy';

/**
 * GatedPage — Concrete example of token-gated content + self-serve tester.
 *
 * This demonstrates how to use <TokenGate> for "a certain page".
 *
 * To gate a real feature:
 *   1. Deploy / create an asset on Warthog (use the Assets tab on testnet).
 *   2. Copy its 64-char asset hash.
 *   3. Use <TokenGate assetHash="..." minBalance="1"> around the protected UI.
 *
 * For a truly separate route/page (outside the tab UI):
 *   - Create a new .astro page
 *   - Render <Wallet client:load> or just the providers + a component that uses TokenGate
 *   - The wallet session is restored automatically from sessionStorage.
 */
const GatedPage = () => {
  const { wallet, isLoggedIn, selectedNode } = useWallet();

  // Self-serve tester state
  const [testAssetHash, setTestAssetHash] = useState('');
  const [testMinBalance, setTestMinBalance] = useState('1');
  const [activeTestHash, setActiveTestHash] = useState(null);
  const [activeTestMin, setActiveTestMin] = useState('1');

  // Asset metadata for the live tester (name lookup)
  const [activeTestMeta, setActiveTestMeta] = useState(null);

  // Example hardcoded token (users should replace this with a real one they control)
  // This is just a placeholder so the UI has something to show.
  const EXAMPLE_ASSET_HASH = 'b92b88491b478c22fbc5b3f03f8b5539555ff2680944a8c847a1eb90ef69894e';
  const EXAMPLE_MIN = '1';

  // Fetched metadata for the example asset (if the current node knows about it)
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

  // Fetch metadata for the hardcoded example whenever the node changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const meta = await lookupAsset(EXAMPLE_ASSET_HASH, selectedNode);
      if (!cancelled) setExampleAssetMeta(meta);
    })();
    return () => { cancelled = true; };
  }, [selectedNode]);

  // Fetch metadata when the live tester activates a new hash
  useEffect(() => {
    let cancelled = false;
    if (activeTestHash) {
      (async () => {
        const meta = await lookupAsset(activeTestHash, selectedNode);
        if (!cancelled) setActiveTestMeta(meta);
      })();
    } else {
      setActiveTestMeta(null);
    }
    return () => { cancelled = true; };
  }, [activeTestHash, selectedNode]);

  // ==================== SERVER-SIDE TOKEN GATE (Netlify Function) ====================
  const [serverSecret, setServerSecret] = useState(null);
  const [serverError, setServerError] = useState(null);
  const [serverLoading, setServerLoading] = useState(false);
  const [useSignature, setUseSignature] = useState(true);

  const fetchServerSecret = async (withSignature) => {
    if (!wallet?.address) {
      setServerError('Please log in first');
      return;
    }

    // If caller didn't specify, fall back to the checkbox state
    const shouldSign = withSignature !== undefined ? withSignature : useSignature;

    setServerLoading(true);
    setServerError(null);
    setServerSecret(null);

    try {
      const payload = {
        address: wallet.address,
        assetHash: EXAMPLE_ASSET_HASH,
        minBalance: EXAMPLE_MIN,
        nodeBase: selectedNode,
      };

      if (shouldSign && wallet.privateKey) {
        const message = `Unlock server-gated secret for asset ${EXAMPLE_ASSET_HASH} as ${wallet.address} at ${Date.now()}`;
        const signer = new ethers.Wallet(wallet.privateKey);
        const signature = await signer.signMessage(message);
        payload.message = message;
        payload.signature = signature;
      }

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

  const startTest = () => {
    const h = testAssetHash.trim().replace(/^0x/, '');
    if (!h || h.length !== 64) {
      alert('Please enter a valid 64-character asset hash');
      return;
    }
    setActiveTestHash(h);
    setActiveTestMin(testMinBalance || '0');
  };

  const clearTest = () => {
    setActiveTestHash(null);
    setActiveTestMin('1');
    setActiveTestMeta(null);
  };

  // Small live indicator using the hook for the example asset
  const exampleGate = useTokenGate(EXAMPLE_ASSET_HASH, EXAMPLE_MIN);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Members Area</h2>
        <p className="mt-2 text-zinc-400">
          This tab demonstrates <span className="font-semibold text-orange-400">token-gated content</span> on Warthog Network.
          Only wallets holding the required asset can see the protected sections.
        </p>
      </div>

      {/* Live Gate Status (from useTokenGate hook) — this is independent proof of the check */}
      <div className="rounded-2xl border border-zinc-700 bg-zinc-950 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold text-sm">Live Gate Status (useTokenGate hook)</div>
          <button
            onClick={() => exampleGate.check?.()}
            className="text-xs px-3 py-1 rounded-lg border border-zinc-700 hover:bg-zinc-900 active:bg-zinc-800"
          >
            Re-check
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="bg-zinc-900 rounded-xl p-3">
            <div className="text-[10px] text-zinc-500">Asset being checked</div>
            <div className="font-mono text-orange-400 break-all text-xs mt-0.5">{EXAMPLE_ASSET_HASH}</div>
            {exampleAssetMeta?.name && <div className="text-emerald-400 text-xs mt-0.5">Name on node: {exampleAssetMeta.name}</div>}
          </div>

          <div className="bg-zinc-900 rounded-xl p-3">
            <div className="text-[10px] text-zinc-500">Your balance (for this asset)</div>
            <div className="text-xl font-semibold tabular-nums mt-0.5 text-white">
              {exampleGate.loading ? '...' : exampleGate.balance}
            </div>
            <div className="text-[10px] text-zinc-500">Minimum required: {EXAMPLE_MIN}</div>
          </div>

          <div className="bg-zinc-900 rounded-xl p-3 flex items-center">
            <div>
              <div className="text-[10px] text-zinc-500 mb-1">Gate decision</div>
              {exampleGate.loading ? (
                <span className="text-zinc-400">Checking...</span>
              ) : exampleGate.hasAccess ? (
                <span className="inline-block rounded-full bg-emerald-500/20 px-3 py-0.5 text-emerald-400 font-medium">✓ GRANTED — you hold enough</span>
              ) : (
                <span className="inline-block rounded-full bg-red-500/20 px-3 py-0.5 text-red-400 font-medium">✕ DENIED — balance too low</span>
              )}
              <div className="text-[10px] text-zinc-500 mt-1">This controls whether the Secret Club perks below can render.</div>
            </div>
          </div>
        </div>
      </div>

      {/* 1. Hardcoded example protected content */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <div className="text-sm font-semibold uppercase tracking-widest text-orange-400">Example Protected Content</div>
          <div className="h-px flex-1 bg-zinc-800" />
        </div>

        {/* The actual gate. Everything inside here is only rendered by React if the balance check passes. */}
        <TokenGate
          assetHash={EXAMPLE_ASSET_HASH}
          minBalance={EXAMPLE_MIN}
          showBalance
          onAccessChange={(granted) => {
            // Optional: you could log or trigger side effects here
            if (granted) console.log('[TokenGate] Access granted for example asset');
          }}
        >
          <div className="rounded-3xl border border-emerald-700/50 bg-emerald-950/30 p-8">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">🔓</span>
              <span className="text-xs uppercase tracking-[1px] text-emerald-400 font-semibold">Token Gate Passed — Content Unlocked</span>
            </div>

            <div className="mb-4 text-2xl">🎉 Welcome, token holder!</div>
            <p className="text-emerald-200/90">
              This entire section (including Secret Club Perk #1 and #2 below) is only visible because your wallet holds at least {EXAMPLE_MIN} unit of{' '}
              <span className="font-semibold text-white">
                {exampleAssetMeta?.name ? exampleAssetMeta.name : 'this asset'}
              </span>.
            </p>
            <div className="mt-1 text-[11px] text-emerald-400/70 font-mono break-all">
              Asset hash: {EXAMPLE_ASSET_HASH}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(EXAMPLE_ASSET_HASH);
                }}
                className="ml-2 text-emerald-300 hover:text-white underline"
              >
                copy
              </button>
            </div>

            {/* The two "secret" perk cards — they literally do not exist in the DOM unless the gate above grants access */}
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

            <div className="mt-6 text-[11px] text-emerald-400/70">
              These perk cards are children of &lt;TokenGate&gt;. They only render when the on-chain balance check returns ≥ {EXAMPLE_MIN}.
            </div>
          </div>
        </TokenGate>

        {/* This note is OUTSIDE the gate on purpose, so it's always visible */}
        <div className="mt-2 text-[10px] text-zinc-500 px-1">
          ↑ The box above (and the two Secret Club perks) will only appear if the Live Gate Status at the top of this section says GRANTED.
          If you see "DENIED" above, the perks are completely absent from the page.
        </div>
      </section>

      {/* How to test "without holding the asset" */}
      <div className="text-xs bg-zinc-950 border border-zinc-800 rounded-2xl p-4">
        <div className="font-semibold mb-1 text-zinc-300">How to confirm the gate is working for you right now</div>
        <ol className="list-decimal list-inside text-zinc-400 space-y-0.5">
          <li>Look at the big "Live Gate Status" box above. It shows your actual balance for this asset + the GRANTED / DENIED decision.</li>
          <li>If it says DENIED, scroll down — the entire green "Welcome, token holder" box + both Secret Club Perks should be missing.</li>
          <li>Use the <strong>Live Token Gate Tester</strong> further down this page: paste the same asset hash (<span className="font-mono text-orange-400">{EXAMPLE_ASSET_HASH.slice(0,16)}…</span>) and min balance "1". It should show the red "Access restricted" screen.</li>
          <li>Only when your balance for this specific asset is ≥ 1 will the perk cards become visible.</li>
        </ol>
        <div className="mt-2 text-[10px] text-amber-400/80">
          Note: This is a client-side gate (good for hiding UI sections). The actual perk text lives in the JavaScript bundle, so a very determined person could find the strings by inspecting the page source. For real secrets you would fetch the sensitive content from a server only after the gate passes.
        </div>
      </div>

      {/* 2. Self-serve live tester — "gate any token" */}
      <section className="border border-zinc-800 rounded-3xl p-6 bg-zinc-950">
        <div className="mb-4">
          <div className="font-semibold">Live Token Gate Tester</div>
          <p className="text-sm text-zinc-400 mt-1">
            Paste any asset hash (from the Assets tab or asset creation) and set a minimum balance. The gate below will update live.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr,120px,auto] mb-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Asset Hash (64 hex chars)</label>
            <input
              className="input w-full font-mono text-sm"
              placeholder="e.g. b92b88491b478c22fbc5b3f03f8b5539555ff2680944a8c847a1eb90ef69894e"
              value={testAssetHash}
              onChange={(e) => setTestAssetHash(e.target.value.trim())}
              onKeyDown={(e) => e.key === 'Enter' && startTest()}
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Min Balance</label>
            <input
              className="input w-full"
              type="text"
              value={testMinBalance}
              onChange={(e) => setTestMinBalance(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={startTest}
              className="flex-1 md:flex-none px-6 py-2.5 rounded-2xl bg-orange-600 hover:bg-orange-700 text-white font-semibold"
            >
              Gate This Token
            </button>
            {activeTestHash && (
              <button
                onClick={clearTest}
                className="px-4 py-2.5 rounded-2xl border border-zinc-700 hover:bg-zinc-900 text-sm"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* The actual live gate */}
        {activeTestHash ? (
          <div className="mt-2">
            <div className="mb-2 text-xs text-zinc-400 flex items-center gap-2">
              Currently gating on:
              <span className="font-mono text-orange-400 break-all">{activeTestHash}</span>
              {activeTestMeta?.name && (
                <span className="text-emerald-400 font-semibold">({activeTestMeta.name})</span>
              )}
              <button
                onClick={() => navigator.clipboard.writeText(activeTestHash)}
                className="text-orange-300 hover:text-white underline ml-1"
              >
                copy
              </button>
            </div>

            <TokenGate
              assetHash={activeTestHash}
              minBalance={activeTestMin}
              key={`${activeTestHash}-${activeTestMin}`} // force remount on change
            >
              <div className="rounded-2xl border border-emerald-700/60 bg-emerald-950/20 p-6">
                <div className="text-emerald-400 font-semibold mb-1">✓ Access Granted</div>
                <p className="text-sm text-zinc-300">
                  Your wallet holds the required balance of this token. Any content you place inside the <code className="text-orange-400">&lt;TokenGate&gt;</code> wrapper would be visible here.
                </p>
                <div className="mt-4 text-xs text-emerald-400/70">
                  You can now safely render premium UI, download links, private data, etc.
                </div>
              </div>
            </TokenGate>
          </div>
        ) : (
          <div className="text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-2xl p-4">
            Enter an asset hash above and click “Gate This Token” to see a live token gate in action.
          </div>
        )}
      </section>

      {/* ==================== SERVER-SIDE GATED SECRET (Netlify Function) ==================== */}
      <section className="border border-emerald-800/60 rounded-3xl p-6 bg-emerald-950/10">
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-lg">Server-Verified Secret (Netlify Function)</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">RECOMMENDED</span>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            The secret lives <strong>only on the server</strong>. The frontend asks a Netlify Function:
            “Does this address actually hold the token on-chain right now?” Only the server can return the real content.
          </p>
        </div>

        {/* Live status recap */}
        <div className="mb-4 rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-xs">
          <div>Checking the same example asset:</div>
          <div className="font-mono text-orange-400 break-all mt-1">{EXAMPLE_ASSET_HASH}</div>
          <div className="mt-1 text-zinc-400">
            Client-side balance: {exampleGate.loading ? '...' : exampleGate.balance} &nbsp;•&nbsp;
            {exampleGate.hasAccess ? 'Client thinks you qualify' : 'Client says you do not qualify'}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => fetchServerSecret(true)}
            disabled={serverLoading || !wallet?.address}
            className="px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold"
          >
            {serverLoading ? 'Asking server...' : 'Fetch secret from server (with signature)'}
          </button>

          <button
            onClick={() => fetchServerSecret(false)}
            disabled={serverLoading || !wallet?.address}
            className="px-4 py-3 rounded-2xl border border-emerald-700 hover:bg-emerald-900/30 text-sm"
          >
            Fetch without signature (weaker)
          </button>

          {(serverSecret || serverError) && (
            <button onClick={clearServerResult} className="text-xs px-3 py-2 text-zinc-400 hover:text-white">
              Clear result
            </button>
          )}
        </div>

        <div className="mt-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            id="useSig"
            checked={useSignature}
            onChange={(e) => setUseSignature(e.target.checked)}
            className="accent-emerald-500"
          />
          <label htmlFor="useSig" className="text-zinc-400">Include signature proof of address ownership (recommended)</label>
        </div>

        {/* Results */}
        {serverSecret && (
          <div className="mt-5 rounded-2xl border border-emerald-600 bg-emerald-950/40 p-5">
            <div className="text-emerald-400 font-semibold mb-2">✓ Server approved — secret delivered</div>
            <pre className="whitespace-pre-wrap text-sm text-emerald-100 bg-black/40 p-4 rounded-xl overflow-auto">
              {serverSecret.secret}
            </pre>
            <div className="mt-3 text-[10px] text-emerald-400/70">
              Served at {serverSecret.servedAt} • On-chain balance reported by server: {serverSecret.balance}
            </div>
          </div>
        )}

        {serverError && (
          <div className="mt-5 rounded-2xl border border-red-700/60 bg-red-950/30 p-4 text-sm">
            <div className="text-red-400 font-semibold">Server denied access</div>
            <div className="mt-1 text-red-300">{serverError}</div>
          </div>
        )}

        <div className="mt-4 text-[11px] text-zinc-500 leading-relaxed">
          <strong>Why this is much stronger:</strong> The actual secret text above is never present in the JavaScript bundle you downloaded.
          Even if someone tampers with the client code or inspects everything, they still have to get the server to say “yes”.
          The server does its own independent on-chain query.
        </div>
      </section>

      {/* How to use for your own "certain page" */}
      <section className="text-xs text-zinc-400 leading-relaxed border-l-2 border-zinc-800 pl-4">
        <div className="font-semibold text-zinc-300 mb-1">How to gate your own page or feature</div>
        <ol className="list-decimal list-inside space-y-1">
          <li>Create or obtain an asset (use the <span className="text-orange-400">Assets</span> tab on a testnet node, or search existing ones).</li>
          <li>Copy the exact 64-character asset hash.</li>
          <li>Wrap any JSX with <code className="font-mono text-orange-400">&lt;TokenGate assetHash="..." minBalance="1"&gt;...&lt;/TokenGate&gt;</code></li>
          <li>Import <code>TokenGate</code> from <code>./TokenGate</code>.</li>
        </ol>
        <p className="mt-2">
          In this tab, the exact asset hash being checked is always shown clearly above each gated section (with name if the node knows it). The gate uses your logged-in wallet and works on mainnet + testnet.
        </p>
      </section>
    </div>
  );
};

export default GatedPage;
