import React, { useEffect, useState } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';

/**
 * TokenGate — Token-gated content wrapper for Warthog Network assets/tokens.
 *
 * Usage:
 *   <TokenGate
 *     assetHash="b92b88491b478c22fbc5b3f03f8b5539555ff2680944a8c847a1eb90ef69894e"
 *     minBalance="1"
 *     requireWallet={true}
 *   >
 *     <SecretClubContent />
 *   </TokenGate>
 *
 * Props:
 * - assetHash: 64-char hex asset hash (the token ID on Warthog). Required.
 * - minBalance: Minimum balance required (in human units, e.g. "1", "0.5"). Default "0".
 * - children: Content shown only when the user holds enough of the token.
 * - fallback: Optional custom "access denied" UI.
 * - loadingFallback: Optional custom loading state.
 * - requireWallet: If true (default), user must be logged in. If false, shows fallback when not logged in.
 * - onAccessChange: Callback (hasAccess: boolean) => void
 * - showBalance: Show the user's current balance in messages (default true).
 *
 * For a standalone "gated page":
 *   - Import this component + the Wallet + Toast providers (or use inside the main app tabs).
 *   - The gate reads the active wallet from WalletContext (which restores from sessionStorage).
 *
 * This uses the existing node proxy and works with both mainnet and testnet assets.
 */
const TokenGate = ({
  assetHash,
  minBalance = '0',
  children,
  fallback,
  loadingFallback,
  requireWallet = true,
  onAccessChange,
  showBalance = true,
}) => {
  const { wallet, selectedNode, checkAssetBalance, isLoggedIn } = useWallet();
  const toast = useToast();

  const [status, setStatus] = useState('checking'); // 'checking' | 'granted' | 'denied' | 'no-wallet'
  const [balance, setBalance] = useState('0');
  const [decimals, setDecimals] = useState(8);
  const [error, setError] = useState(null);

  const normalizedHash = assetHash ? assetHash.toLowerCase().replace(/^0x/, '') : null;

  const minNum = parseFloat(minBalance || '0');

  useEffect(() => {
    let cancelled = false;

    const runCheck = async () => {
      if (!normalizedHash) {
        setStatus('denied');
        setError('No asset hash provided');
        onAccessChange?.(false);
        return;
      }

      if (requireWallet && !wallet?.address) {
        setStatus('no-wallet');
        onAccessChange?.(false);
        return;
      }

      setStatus('checking');
      setError(null);

      try {
        const result = await checkAssetBalance(normalizedHash);

        if (cancelled) return;

        const balNum = parseFloat(result?.balance || '0');
        setBalance(result?.balance || '0');
        setDecimals(result?.decimals ?? 8);

        const hasAccess = balNum >= minNum;

        setStatus(hasAccess ? 'granted' : 'denied');
        onAccessChange?.(hasAccess);

        if (hasAccess && result?.balance) {
          // subtle success hint only on first grant in a session (avoid spam)
        }
      } catch (e) {
        if (cancelled) return;
        console.error('TokenGate check failed:', e);
        setError(e?.message || 'Failed to check token balance');
        setStatus('denied');
        onAccessChange?.(false);
      }
    };

    runCheck();

    return () => {
      cancelled = true;
    };
  }, [normalizedHash, minBalance, wallet?.address, selectedNode, requireWallet, checkAssetBalance]);

  // No wallet state
  if (status === 'no-wallet') {
    return (
      fallback || (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-950 p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-2xl">🔒</div>
          <div className="font-semibold text-white">Wallet required</div>
          <p className="mt-1 text-sm text-zinc-400">
            Connect your Warthog wallet to check token access.
          </p>
        </div>
      )
    );
  }

  // Loading
  if (status === 'checking') {
    return (
      loadingFallback || (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-center">
          <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-orange-500" />
          <div className="text-sm text-zinc-400">Checking token balance...</div>
          {normalizedHash && (
            <div className="mt-2 font-mono text-[10px] text-zinc-600">
              {normalizedHash.slice(0, 12)}…{normalizedHash.slice(-10)}
            </div>
          )}
        </div>
      )
    );
  }

  // Access granted — render protected content
  if (status === 'granted') {
    return <>{children}</>;
  }

  // Access denied
  const displayMin = minNum > 0 ? minNum : 0;

  const defaultFallback = (
    <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-6">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-xl">🔐</div>
        <div className="flex-1">
          <div className="font-semibold text-red-400">Access restricted</div>
          <p className="mt-1 text-sm text-zinc-300">
            You need at least{' '}
            <span className="font-semibold text-white tabular-nums">
              {displayMin} {showBalance && balance !== '0' ? '' : 'token unit(s)'}
            </span>{' '}
            of this asset to view this content.
          </p>

          <div className="mt-3 rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-xs">
            <div className="text-zinc-400 mb-1">Required token (asset hash)</div>
            <div
              className="font-mono text-orange-400 break-all cursor-pointer hover:underline active:text-orange-300"
              onClick={() => {
                if (normalizedHash) {
                  navigator.clipboard.writeText(normalizedHash);
                  toast?.success?.('Asset hash copied');
                }
              }}
              title="Click to copy"
            >
              {normalizedHash}
            </div>

            {showBalance && (
              <div className="mt-2 flex items-center justify-between text-zinc-400">
                <span>Your balance</span>
                <span className="font-mono text-white tabular-nums">
                  {balance} <span className="text-zinc-500">(decimals: {decimals})</span>
                </span>
              </div>
            )}
          </div>

          <p className="mt-3 text-[11px] text-zinc-500">
            Make sure you are connected to the correct node and that the asset exists on this network.
          </p>
        </div>
      </div>
    </div>
  );

  return fallback || defaultFallback;
};

export default TokenGate;

/**
 * Convenience hook if you want to do imperative checks in your own components.
 *
 * const { hasAccess, balance, loading, check } = useTokenGate(assetHash, minBalance);
 */
export function useTokenGate(assetHash, minBalance = '0') {
  const { checkAssetBalance, wallet } = useWallet();
  const [state, setState] = useState({
    hasAccess: false,
    balance: '0',
    decimals: 8,
    loading: false,
    error: null,
  });

  const normalized = assetHash ? assetHash.toLowerCase().replace(/^0x/, '') : null;
  const minNum = parseFloat(minBalance || '0');

  const check = async () => {
    if (!normalized || !wallet?.address) {
      setState(s => ({ ...s, hasAccess: false, loading: false }));
      return false;
    }
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const res = await checkAssetBalance(normalized);
      const balNum = parseFloat(res.balance || '0');
      const next = {
        hasAccess: balNum >= minNum,
        balance: res.balance || '0',
        decimals: res.decimals ?? 8,
        loading: false,
        error: null,
      };
      setState(next);
      return next.hasAccess;
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: e.message || 'check failed', hasAccess: false }));
      return false;
    }
  };

  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized, minBalance, wallet?.address]);

  return { ...state, check, walletAddress: wallet?.address };
}
