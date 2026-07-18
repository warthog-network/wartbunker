import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import FormattedNumber from './FormattedNumber.jsx';
import { useNumberDisplay } from './NumberDisplayContext.jsx';
import {
  createWarthogApi,
  formatSubmitError,
  formatSubmitResult,
  getNodeData,
  normalizeAssetHash,
  signAndSubmitTransaction,
} from '../utils/warthogClient.js';
import { computePoolSpotPrice, formatAssetPrice } from '../utils/dexPrice.js';
import { DEFAULT_NODE_URL } from '../utils/presetNodes.js';
import { readPublicSession } from '../utils/sessionWallet.js';
import {
  amountExceedsAvailable,
  formatBalanceBreakdown,
  insufficientFreeBalanceMessage,
  isValidAssetHash,
} from '../utils/warthogFormat.js';

const DEFAULT_MARKET_SLIPPAGE_PCT = 5;

const DexPage = ({ selectedNode: propSelectedNode, wallet: propWallet }) => {
  const {
    nextNonce: contextNextNonce,
    selectedNode: contextSelectedNode,
    nodeMinFeeStr,
    suggestedTxFee,
    isSigningUnlocked,
    isSessionLocked,
    dexPoolPrefill,
    setDexPoolPrefill,
    refreshBalance,
    assetBalances = [],
    balanceAvailable,
    balanceLocked,
    balance,
    addWatchedAsset,
  } = useWallet();

  const selectedNode = propSelectedNode || contextSelectedNode || DEFAULT_NODE_URL;
  const wallet = propWallet || readPublicSession();
  const account = wallet?.address || '';

  const toast = useToast();
  const {
    limitOrderBuyClasses,
    limitOrderSellClasses,
    liquidityPoolClasses,
  } = useNumberDisplay();

  // Primary UI: Market | Limit only
  const [orderMode, setOrderMode] = useState('market'); // market | limit
  /** true = you pay WART (buy asset); false = you pay asset (sell for WART) */
  const [payingWart, setPayingWart] = useState(true);
  const [selectedAsset, setSelectedAsset] = useState(null); // { hash, symbol, name, decimals }
  const [payAmount, setPayAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState(''); // WART per 1 asset
  const [slippagePct, setSlippagePct] = useState(String(DEFAULT_MARKET_SLIPPAGE_PCT));
  const [txFee, setTxFee] = useState(suggestedTxFee);
  const [nonceOverride, setNonceOverride] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showTokenPicker, setShowTokenPicker] = useState(false);
  const [manualHashInput, setManualHashInput] = useState('');
  const [assetDecimals, setAssetDecimals] = useState(8);

  const [spotPrice, setSpotPrice] = useState(null);
  const [marketInfo, setMarketInfo] = useState(null);
  const [marketLoading, setMarketLoading] = useState(false);

  const [paySpendable, setPaySpendable] = useState(null);
  const [paySpendableLoading, setPaySpendableLoading] = useState(false);

  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});

  // Advanced: liquidity / pool tools (kept for power users)
  const [advancedSubTab, setAdvancedSubTab] = useState('orders'); // orders | liquidity | pool | market
  const [liquidityMode, setLiquidityMode] = useState('deposit');
  const [positionPoolMode, setPositionPoolMode] = useState('deposit');
  const [poolAssetHash, setPoolAssetHash] = useState('');

  const feeHint = nodeMinFeeStr
    ? `Node minimum: ${nodeMinFeeStr} WART. Suggested: ${suggestedTxFee} WART.`
    : `Suggested: ${suggestedTxFee} WART.`;

  useEffect(() => {
    setTxFee(suggestedTxFee);
  }, [suggestedTxFee]);

  useEffect(() => {
    import('../utils/encodeLimitPrice.js').catch(() => {});
  }, []);

  // Token list from watched balances
  const tokenOptions = useMemo(() => {
    return (assetBalances || []).map((a) => ({
      hash: (a.hash || '').toLowerCase().replace(/^0x/i, ''),
      symbol: a.name || a.customName || 'TOKEN',
      name: a.customName || a.name || 'Asset',
      decimals: a.decimals ?? 8,
      available: a.available ?? a.balance ?? '0',
      locked: a.locked ?? '0',
      total: a.total ?? a.balance ?? '0',
    })).filter((t) => t.hash && t.hash.length === 64);
  }, [assetBalances]);

  // Prefill from Overview "Manage in DEX"
  useEffect(() => {
    if (!dexPoolPrefill?.hash) return;
    const hash = dexPoolPrefill.hash.toLowerCase().replace(/^0x/i, '');
    const match = tokenOptions.find((t) => t.hash === hash);
    setSelectedAsset(match || {
      hash,
      symbol: dexPoolPrefill.name || 'TOKEN',
      name: dexPoolPrefill.name || 'Asset',
      decimals: 8,
    });
    setPoolAssetHash(hash);
    setManualHashInput(hash);
    setShowAdvanced(true);
    setAdvancedSubTab('pool');
    setDexPoolPrefill(null);
    // load pool after state settles
    setTimeout(() => loadPoolAndPosition(hash), 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dexPoolPrefill, setDexPoolPrefill]);

  // Auto-select first tracked asset if none chosen
  useEffect(() => {
    if (!selectedAsset && tokenOptions.length > 0) {
      setSelectedAsset(tokenOptions[0]);
      setAssetDecimals(tokenOptions[0].decimals ?? 8);
      setManualHashInput(tokenOptions[0].hash);
    }
  }, [tokenOptions, selectedAsset]);

  const assetHash = selectedAsset?.hash || '';

  // ==================== NONCE ====================
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

  const isNodeSuccess = (result) => {
    if (!result || result.error) return false;
    if (result.code !== undefined && result.code !== 0) return false;
    return true;
  };

  const getNodeError = (result) =>
    result?.error || result?.message || (result?.code != null ? `Node error (code ${result.code})` : null);

  // ==================== SAFE RENDER HELPERS ====================
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
      if (v.doubleAdjusted != null) return String(v.doubleAdjusted);
    }
    return fallback;
  };

  const query = async (key, path, method = 'GET', data = null) => {
    setLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const api = await createWarthogApi(selectedNode);
      let result;
      if (method === 'POST') {
        const submitRes = await api.submitTransaction(data);
        result = submitRes.success
          ? { code: 0, data: submitRes.data }
          : { code: submitRes.code, error: submitRes.error };
      } else {
        result = await getNodeData(api, path);
      }
      setResults((prev) => ({ ...prev, [key]: result }));
      return result;
    } catch (err) {
      setResults((prev) => ({ ...prev, [key]: { error: err.message } }));
      throw err;
    } finally {
      setLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const copyToClipboard = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Copied to clipboard');
    }).catch(() => {});
  };

  // ==================== MARKET + BALANCE ====================
  const loadMarket = useCallback(async (hash) => {
    if (!hash || !isValidAssetHash(hash)) {
      setSpotPrice(null);
      setMarketInfo(null);
      return null;
    }
    setMarketLoading(true);
    try {
      const api = await createWarthogApi(selectedNode);
      const result = await getNodeData(api, `dex/market/${encodeURIComponent(hash)}`);
      if (result?.code === 0 && result.data) {
        const spot = computePoolSpotPrice(result.data);
        const asset = result.data.baseAsset || result.data.asset || {};
        const decimals = asset.decimals ?? 8;
        setSpotPrice(spot);
        setMarketInfo(result.data);
        setAssetDecimals(decimals);
        if (asset.name) {
          setSelectedAsset((prev) => (prev && prev.hash === hash
            ? { ...prev, symbol: asset.name, name: asset.name, decimals }
            : prev));
        }
        return { spot, data: result.data, decimals };
      }
      setSpotPrice(null);
      setMarketInfo(null);
      return null;
    } catch {
      setSpotPrice(null);
      setMarketInfo(null);
      return null;
    } finally {
      setMarketLoading(false);
    }
  }, [selectedNode]);

  useEffect(() => {
    if (assetHash) loadMarket(assetHash);
  }, [assetHash, loadMarket]);

  const refreshPaySpendable = useCallback(async ({ silent = false } = {}) => {
    if (!account || !selectedNode) {
      setPaySpendable(null);
      return null;
    }

    if (!silent) setPaySpendableLoading(true);
    try {
      const api = await createWarthogApi(selectedNode);

      if (payingWart) {
        const res = await api.getAccountWartBalance(account);
        if (!res.success) throw new Error(res.error || 'Failed to fetch WART balance');
        const breakdown = await formatBalanceBreakdown(res.data?.wart, { kind: 'wart' });
        const info = {
          side: 'buy',
          unit: 'WART',
          name: 'WART',
          decimals: 8,
          available: breakdown.available,
          locked: breakdown.locked,
          total: breakdown.total,
          hasLocked: breakdown.hasLocked,
        };
        setPaySpendable(info);
        return info;
      }

      if (!isValidAssetHash(assetHash)) {
        setPaySpendable(null);
        return null;
      }

      const res = await api.getAccountAssetBalance(account, assetHash);
      if (!res.success) throw new Error(res.error || 'Failed to fetch asset balance');
      const tokenInfo = res.data?.token || {};
      const decimals = tokenInfo.decimals ?? res.data?.balance?.total?.decimals ?? assetDecimals ?? 8;
      const breakdown = await formatBalanceBreakdown(res.data?.balance, {
        kind: 'token',
        decimals,
      });
      const info = {
        side: 'sell',
        unit: tokenInfo.name || selectedAsset?.symbol || 'asset',
        name: tokenInfo.name || selectedAsset?.name || 'Asset',
        decimals,
        assetHash,
        available: breakdown.available,
        locked: breakdown.locked,
        total: breakdown.total,
        hasLocked: breakdown.hasLocked,
      };
      setPaySpendable(info);
      setAssetDecimals(decimals);
      return info;
    } catch (err) {
      if (!silent) toast.error(err.message || 'Could not load spendable balance');
      setPaySpendable(null);
      return null;
    } finally {
      if (!silent) setPaySpendableLoading(false);
    }
  }, [account, selectedNode, payingWart, assetHash, assetDecimals, selectedAsset, toast]);

  useEffect(() => {
    const t = setTimeout(() => refreshPaySpendable({ silent: true }), 50);
    return () => clearTimeout(t);
  }, [refreshPaySpendable]);

  // Fallback spendable from context when live fetch not ready
  const displayPayAvailable = useMemo(() => {
    if (paySpendable) return paySpendable;
    if (payingWart) {
      return {
        available: balanceAvailable ?? balance ?? '0',
        locked: balanceLocked ?? '0',
        total: balance ?? balanceAvailable ?? '0',
        unit: 'WART',
        hasLocked: parseFloat(balanceLocked || '0') > 0,
      };
    }
    const match = tokenOptions.find((t) => t.hash === assetHash);
    if (match) {
      return {
        available: match.available,
        locked: match.locked,
        total: match.total,
        unit: match.symbol,
        hasLocked: parseFloat(match.locked || '0') > 0,
      };
    }
    return null;
  }, [paySpendable, payingWart, balanceAvailable, balanceLocked, balance, tokenOptions, assetHash]);

  // ==================== PRICE / ESTIMATE ====================
  const effectiveLimitPrice = useMemo(() => {
    if (orderMode === 'limit') {
      const p = parseFloat(String(limitPrice).replace(',', '.'));
      return Number.isFinite(p) && p > 0 ? p : null;
    }
    // Market: spot adjusted by slippage
    if (spotPrice == null || spotPrice <= 0) return null;
    const slip = Math.max(0, Math.min(50, parseFloat(slippagePct) || DEFAULT_MARKET_SLIPPAGE_PCT)) / 100;
    // Buy: willing to pay more → higher limit. Sell: willing to accept less → lower limit.
    return payingWart ? spotPrice * (1 + slip) : spotPrice * (1 - slip);
  }, [orderMode, limitPrice, spotPrice, slippagePct, payingWart]);

  const receiveEstimate = useMemo(() => {
    const amt = parseFloat(String(payAmount).replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0 || effectiveLimitPrice == null || effectiveLimitPrice <= 0) {
      return null;
    }
    // Buy: pay WART → receive ~ amount / price asset
    // Sell: pay asset → receive ~ amount * price WART
    if (payingWart) return amt / effectiveLimitPrice;
    return amt * effectiveLimitPrice;
  }, [payAmount, effectiveLimitPrice, payingWart]);

  // ==================== ACTIONS ====================
  const fillMax = async () => {
    const info = paySpendable || (await refreshPaySpendable());
    if (!info) {
      toast.error(payingWart ? 'Could not load available WART' : 'Select an asset and load balance first');
      return;
    }
    setPayAmount(info.available);
    toast.success(`Filled available: ${info.available} ${info.unit}`);
  };

  const flipDirection = () => {
    setPayingWart((v) => !v);
    setPayAmount('');
  };

  const selectToken = (token) => {
    setSelectedAsset(token);
    setAssetDecimals(token.decimals ?? 8);
    setManualHashInput(token.hash);
    setShowTokenPicker(false);
    setPoolAssetHash(token.hash);
  };

  const applyManualHash = () => {
    let hash = manualHashInput.trim().replace(/^0x/i, '').toLowerCase();
    if (!isValidAssetHash(hash)) {
      toast.error('Asset hash must be 64 hex characters');
      return;
    }
    const match = tokenOptions.find((t) => t.hash === hash);
    const token = match || {
      hash,
      symbol: hash.slice(0, 4).toUpperCase(),
      name: 'Asset',
      decimals: assetDecimals || 8,
    };
    setSelectedAsset(token);
    setPoolAssetHash(hash);
    addWatchedAsset?.(hash, token.name !== 'Asset' ? token.name : '');
    toast.success('Asset selected');
  };

  const handleSwap = async () => {
    if (!assetHash || !isValidAssetHash(assetHash)) {
      toast.error('Select a token to swap');
      return;
    }
    const amountStr = String(payAmount).trim().replace(',', '.');
    if (!amountStr || parseFloat(amountStr) <= 0) {
      toast.error('Enter an amount');
      return;
    }
    if (!isSigningUnlocked) {
      toast.error(isSessionLocked ? 'Unlock your wallet to swap' : 'Wallet not loaded. Please log in again.');
      return;
    }

    let priceForEncode = effectiveLimitPrice;
    if (orderMode === 'limit') {
      const p = parseFloat(String(limitPrice).replace(',', '.'));
      if (!Number.isFinite(p) || p <= 0) {
        toast.error('Enter a valid limit price (WART per token)');
        return;
      }
      priceForEncode = p;
    } else if (priceForEncode == null) {
      // Try refresh market once
      const m = await loadMarket(assetHash);
      if (!m?.spot) {
        toast.error('No pool spot price — cannot place a market order. Try Limit instead.');
        return;
      }
      const slip = Math.max(0, Math.min(50, parseFloat(slippagePct) || DEFAULT_MARKET_SLIPPAGE_PCT)) / 100;
      priceForEncode = payingWart ? m.spot * (1 + slip) : m.spot * (1 - slip);
    }

    setLoading((prev) => ({ ...prev, swap: true }));
    setResults((prev) => ({ ...prev, swap: null }));

    try {
      const spendable = await refreshPaySpendable({ silent: true });
      let decimalsStr = String(assetDecimals || 8);
      if (spendable) {
        if (!payingWart && spendable.decimals != null) {
          decimalsStr = String(spendable.decimals);
        }
        if (amountExceedsAvailable(amountStr, spendable.available)) {
          const msg = insufficientFreeBalanceMessage({
            available: spendable.available,
            locked: spendable.locked,
            unit: spendable.unit,
          });
          setPayAmount(spendable.available);
          setResults((prev) => ({ ...prev, swap: formatSubmitError(msg) }));
          toast.error(msg);
          return;
        }
      }

      const { encodeLimitPriceHex } = await import('../utils/encodeLimitPrice.js');
      let limitHex;
      try {
        limitHex = await encodeLimitPriceHex(String(priceForEncode), decimalsStr, {
          ceil: payingWart, // buy rounds up (more aggressive)
        });
      } catch {
        limitHex = await encodeLimitPriceHex(String(priceForEncode), decimalsStr, {
          ceil: true,
        });
      }

      let nonceId = getSmartNonce();
      if (nonceOverride.trim() !== '') {
        const parsed = parseInt(nonceOverride, 10);
        if (!Number.isNaN(parsed)) nonceId = parsed;
      }

      const api = await createWarthogApi(selectedNode);
      const { nonce, data } = await signAndSubmitTransaction(api, {
        nonceId,
        fee: (txFee || suggestedTxFee).toString().trim().replace(',', '.') || suggestedTxFee,
        buildSpec: {
          type: 'LIMIT_SWAP',
          assetHash,
          isBuy: payingWart,
          amount: amountStr,
          assetDecimals: decimalsStr,
          limitHex,
        },
      });

      setResults((prev) => ({ ...prev, swap: formatSubmitResult(data) }));
      updateNonceAfterSuccess(nonce);
      setNonceOverride('');

      const label = orderMode === 'market'
        ? (payingWart ? 'Market buy submitted' : 'Market sell submitted')
        : (payingWart ? 'Limit buy placed' : 'Limit sell placed');
      toast.success(
        orderMode === 'market'
          ? `${label} — may fill against the pool at your slippage price`
          : `${label} — funds may stay locked until the order fills`,
      );
      refreshPaySpendable({ silent: true });
      refreshBalance?.();
      loadMarket(assetHash);
    } catch (err) {
      console.error(err);
      let message = err.message || 'Unknown error';
      if (/insufficient\s+(token\s+)?balance/i.test(message)) {
        const spendable = paySpendable || (await refreshPaySpendable({ silent: true }));
        if (spendable) {
          message = insufficientFreeBalanceMessage({
            available: spendable.available,
            locked: spendable.locked,
            unit: spendable.unit,
          });
        }
      }
      setResults((prev) => ({ ...prev, swap: formatSubmitError(message) }));
      toast.error('Swap failed: ' + message);
    } finally {
      setLoading((prev) => ({ ...prev, swap: false }));
    }
  };

  // ==================== ADVANCED: LIQUIDITY HANDLERS ====================
  const handleLiquidityDeposit = async () => {
    const assetHashRaw = document.getElementById('liquidityAssetHash')?.value.trim() || '';
    const assetAmountStr = document.getElementById('liquidityAssetAmount')?.value.trim() || '';
    const decimalsStr = document.getElementById('liquidityDecimals')?.value || '8';
    const wartAmountStr = document.getElementById('liquidityWartAmount')?.value.trim() || '';
    const nonceOverrideRaw = document.getElementById('liquidityNonceOverride')?.value.trim() || '';
    let nonceId = getSmartNonce();
    if (nonceOverrideRaw !== '') {
      const parsed = parseInt(nonceOverrideRaw, 10);
      if (!Number.isNaN(parsed)) nonceId = parsed;
    }

    if (!assetHashRaw || !assetAmountStr || !wartAmountStr) {
      toast.error('Asset Hash, Asset Amount, and WART Amount are required');
      return;
    }
    if (!isSigningUnlocked) {
      toast.error(isSessionLocked ? 'Unlock your wallet to deposit liquidity' : 'Wallet not loaded. Please log in again.');
      return;
    }

    setLoading((prev) => ({ ...prev, liquidityDeposit: true }));
    setResults((prev) => ({ ...prev, liquidityDeposit: null }));

    try {
      const api = await createWarthogApi(selectedNode);
      const feeRaw = document.getElementById('liquidityDepositFee')?.value?.trim().replace(',', '.');
      const { nonce, data } = await signAndSubmitTransaction(api, {
        nonceId,
        fee: feeRaw || suggestedTxFee,
        buildSpec: {
          type: 'LIQUIDITY_DEPOSIT',
          assetHash: assetHashRaw,
          assetAmount: assetAmountStr,
          decimals: decimalsStr,
          wartAmount: wartAmountStr,
        },
      });
      setResults((prev) => ({ ...prev, liquidityDeposit: formatSubmitResult(data) }));
      updateNonceAfterSuccess(nonce);
      toast.success('Liquidity deposit sent');
      refreshBalance?.();
    } catch (err) {
      setResults((prev) => ({ ...prev, liquidityDeposit: formatSubmitError(err.message || 'Unknown error') }));
      toast.error('Liquidity deposit failed: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading((prev) => ({ ...prev, liquidityDeposit: false }));
    }
  };

  const handleLiquidityWithdraw = async () => {
    const assetHashRaw = document.getElementById('liquidityWithdrawAssetHash')?.value.trim() || '';
    const sharesStr = document.getElementById('liquidityWithdrawShares')?.value.trim() || '';
    const nonceOverrideRaw = document.getElementById('liquidityWithdrawNonceOverride')?.value.trim() || '';
    let nonceId = getSmartNonce();
    if (nonceOverrideRaw !== '') {
      const parsed = parseInt(nonceOverrideRaw, 10);
      if (!Number.isNaN(parsed)) nonceId = parsed;
    }

    if (!assetHashRaw || !sharesStr) {
      toast.error('Asset Hash and LP shares are required');
      return;
    }
    if (!isSigningUnlocked) {
      toast.error(isSessionLocked ? 'Unlock your wallet to withdraw liquidity' : 'Wallet not loaded. Please log in again.');
      return;
    }

    setLoading((prev) => ({ ...prev, liquidityWithdraw: true }));
    setResults((prev) => ({ ...prev, liquidityWithdraw: null }));

    try {
      const api = await createWarthogApi(selectedNode);
      const feeRaw = document.getElementById('liquidityWithdrawFee')?.value?.trim().replace(',', '.');
      const { nonce, data } = await signAndSubmitTransaction(api, {
        nonceId,
        fee: feeRaw || suggestedTxFee,
        buildSpec: {
          type: 'LIQUIDITY_WITHDRAW',
          assetHash: assetHashRaw,
          shares: sharesStr,
        },
      });
      setResults((prev) => ({ ...prev, liquidityWithdraw: formatSubmitResult(data) }));
      updateNonceAfterSuccess(nonce);
      toast.success('Liquidity withdrawal sent');
      refreshBalance?.();
    } catch (err) {
      setResults((prev) => ({ ...prev, liquidityWithdraw: formatSubmitError(err.message || 'Unknown error') }));
      toast.error('Liquidity withdrawal failed: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading((prev) => ({ ...prev, liquidityWithdraw: false }));
    }
  };

  const handlePositionPoolDeposit = async () => {
    const assetHashRaw = poolAssetHash.trim() || assetHash;
    const assetAmountStr = document.getElementById('positionPoolAssetAmount')?.value.trim() || '';
    const decimalsStr = document.getElementById('positionPoolDecimals')?.value || String(assetDecimals || 8);
    const wartAmountStr = document.getElementById('positionPoolWartAmount')?.value.trim() || '';
    const nonceOverrideRaw = document.getElementById('positionPoolNonceOverride')?.value.trim() || '';
    let nonceId = getSmartNonce();
    if (nonceOverrideRaw !== '') {
      const parsed = parseInt(nonceOverrideRaw, 10);
      if (!Number.isNaN(parsed)) nonceId = parsed;
    }

    if (!assetHashRaw || !assetAmountStr || !wartAmountStr) {
      toast.error('Load a pool first, then enter Asset Amount and WART Amount');
      return;
    }
    if (!isSigningUnlocked) {
      toast.error(isSessionLocked ? 'Unlock your wallet to deposit liquidity' : 'Wallet not loaded. Please log in again.');
      return;
    }

    setLoading((prev) => ({ ...prev, liquidityDeposit: true }));
    setResults((prev) => ({ ...prev, liquidityDeposit: null }));

    try {
      const api = await createWarthogApi(selectedNode);
      const feeRaw = document.getElementById('positionPoolDepositFee')?.value?.trim().replace(',', '.');
      const { nonce, data } = await signAndSubmitTransaction(api, {
        nonceId,
        fee: feeRaw || suggestedTxFee,
        buildSpec: {
          type: 'LIQUIDITY_DEPOSIT',
          assetHash: assetHashRaw,
          assetAmount: assetAmountStr,
          decimals: decimalsStr,
          wartAmount: wartAmountStr,
        },
      });
      setResults((prev) => ({ ...prev, liquidityDeposit: formatSubmitResult(data) }));
      updateNonceAfterSuccess(nonce);
      toast.success('Liquidity deposit sent');
      loadPoolAndPosition(assetHashRaw);
      refreshBalance?.();
    } catch (err) {
      setResults((prev) => ({ ...prev, liquidityDeposit: formatSubmitError(err.message || 'Unknown error') }));
      toast.error('Liquidity deposit failed: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading((prev) => ({ ...prev, liquidityDeposit: false }));
    }
  };

  const fillWithdrawFromLpBalance = () => {
    const balanceResult = results.myLiquidityBalance;
    if (!balanceResult || balanceResult.code !== 0) {
      toast.error('Load pool & position first');
      return;
    }
    const balData = balanceResult.data || {};
    const balanceInfo = balData.balance?.total || balData.balance || balData;
    const shares = safeStr(balanceInfo, '');
    if (!shares || shares === '0') {
      toast.error('No LP shares found for this pool');
      return;
    }
    const poolHash = poolAssetHash || assetHash || '';
    const assetInput = document.getElementById('liquidityWithdrawAssetHash');
    const sharesInput = document.getElementById('liquidityWithdrawShares');
    if (assetInput && poolHash) assetInput.value = poolHash;
    if (sharesInput) sharesInput.value = shares;
    toast.success('Filled withdraw form with your LP share balance');
  };

  const loadPoolAndPosition = async (assetHashOverride) => {
    const assetRaw = assetHashOverride || poolAssetHash || assetHash || document.getElementById('poolAssetHash')?.value?.trim() || '';
    if (!assetRaw) {
      toast.error('Please enter an Asset Hash');
      return;
    }
    let hash = assetRaw;
    if (hash.toLowerCase().startsWith('0x')) hash = hash.slice(2);
    if (hash.length !== 64) {
      toast.error('Asset Hash must be exactly 64 hex characters');
      return;
    }
    setPoolAssetHash(hash);
    await query('poolMarket', `dex/market/${encodeURIComponent(hash)}`);
    if (account) {
      await query('myAssetBalance', `account/${account}/balance/asset:${hash}`);
      await query('myLiquidityBalance', `account/${account}/balance/liquidity:${hash}`);
    }
  };

  // ==================== RENDER HELPERS ====================
  const renderTransactionResult = (result, type) => {
    if (!result) return null;
    const isSuccess = isNodeSuccess(result);
    const txHash = result.data?.txHash || result.txHash || result.data?.hash || null;

    return (
      <div className={`mt-4 rounded-2xl border p-4 ${isSuccess ? 'bg-emerald-950/40 border-emerald-700' : 'bg-red-950/40 border-red-700'}`}>
        <div className="flex items-center gap-3 mb-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm ${isSuccess ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
            {isSuccess ? '✓' : '!'}
          </div>
          <div>
            <div className={`font-semibold ${isSuccess ? 'text-emerald-400' : 'text-red-400'}`}>
              {isSuccess ? `${type} Submitted` : `${type} Failed`}
            </div>
            <div className="text-xs text-zinc-400">
              {isSuccess
                ? 'Sent to node · Check History for confirmation'
                : (getNodeError(result) || 'The node rejected this transaction')}
            </div>
          </div>
        </div>
        {txHash && (
          <div
            onClick={() => copyToClipboard(txHash)}
            className="mt-2 p-2 bg-zinc-950 rounded-xl border border-zinc-700 font-mono text-xs text-emerald-400 break-all cursor-pointer hover:text-emerald-300"
          >
            {txHash}
          </div>
        )}
        {result.error && <div className="mt-2 text-sm text-red-400">{result.error}</div>}
      </div>
    );
  };

  const renderPoolMarketCard = (result) => {
    try {
      if (!result || result.code !== 0 || !result.data) {
        return (
          <div className="mt-4 p-4 bg-zinc-950 border border-zinc-700 rounded-2xl text-sm text-zinc-400">
            No pool/market data available.
          </div>
        );
      }

      const d = result.data;
      const asset = d.asset || d.baseAsset || d.market?.asset || {};
      const liquidity = d.liquidityPool || d.liquidity || d.reserves || d.poolReserves || d.pool || {};
      const wartReserve = liquidity.wart || liquidity.WART || '0';
      const assetReserve = liquidity.asset || liquidity[asset.name] || liquidity.assetE8 || '0';
      const spot = computePoolSpotPrice(d);
      const priceRaw = d.price || d.spotPrice || d.doubleAdjustedPrice || d.marketPrice;
      const priceDisplayValue = spot ?? (
        priceRaw != null
          ? (typeof priceRaw === 'object' && priceRaw.doubleAdjusted != null
            ? priceRaw.doubleAdjusted
            : priceRaw)
          : null
      );

      return (
        <div className={`mt-4 bg-zinc-950 border rounded-2xl overflow-hidden ${liquidityPoolClasses.borderPanel}`}>
          <div className="px-4 py-3 bg-zinc-900 flex items-center justify-between border-b border-zinc-800">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white text-xl font-bold ${liquidityPoolClasses.bgSolid}`}>
                {asset.name?.[0] || 'P'}
              </div>
              <div>
                <div className="text-lg font-semibold text-white">
                  {asset.name} <span className={liquidityPoolClasses.textFaint}>/ WART</span>
                </div>
                <div className="font-mono text-[10px] text-zinc-500">
                  {asset.decimals || 8} decimals
                </div>
              </div>
            </div>
            {asset.hash && (
              <button
                type="button"
                onClick={() => copyToClipboard(asset.hash)}
                className="text-right text-[10px] text-zinc-500 hover:text-zinc-300"
              >
                {asset.hash.slice(0, 8)}…{asset.hash.slice(-6)}
              </button>
            )}
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500 mb-1">WART reserve</div>
              <FormattedNumber value={wartReserve} variant="balance" className="text-xl font-semibold" />
            </div>
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500 mb-1">{asset.name || 'Asset'} reserve</div>
              <FormattedNumber value={assetReserve} variant="balance" className="text-xl font-semibold" />
            </div>
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500 mb-1">Spot</div>
              <FormattedNumber value={priceDisplayValue} overrides={{ maxDecimals: 8 }} className="text-xl font-semibold" />
              <div className="text-[10px] text-zinc-500">WART per {asset.name || 'asset'}</div>
            </div>
          </div>
        </div>
      );
    } catch {
      return (
        <pre className="mt-4 text-[10px] bg-black/60 p-3 rounded-xl overflow-auto max-h-60 text-zinc-400">
          {JSON.stringify(result, null, 2)}
        </pre>
      );
    }
  };

  const renderLiquiditySharesCard = (result) => {
    try {
      if (!result || result.code !== 0 || !result.data) return null;
      const balData = result.data || {};
      const assetInfo = balData.token || balData.asset || {};
      const balanceInfo = balData.balance?.total || balData.balance || balData;
      const assetName = assetInfo.name || 'Pool';
      return (
        <div className={`mt-4 border rounded-2xl p-4 ${liquidityPoolClasses.bgPanel} ${liquidityPoolClasses.border}`}>
          <div className={`text-xs tracking-wider font-medium ${liquidityPoolClasses.text}`}>YOUR LP SHARES</div>
          <FormattedNumber value={balanceInfo} variant="balance" className="text-3xl font-semibold mt-1 block" />
          <div className={`text-xs mt-1 ${liquidityPoolClasses.textMuted}`}>{assetName} pool</div>
        </div>
      );
    } catch {
      return null;
    }
  };

  const renderOpenOrdersCompact = (result, queriedAssetHash = null) => {
    if (!result || result.code !== 0) {
      return (
        <div className="mt-4 p-6 bg-zinc-950 border border-zinc-700 rounded-2xl text-center text-sm text-zinc-400">
          Failed to load orders
        </div>
      );
    }

    let assetGroups = [];
    const rawData = result.data;

    if (Array.isArray(rawData) && rawData.length > 0) {
      const first = rawData[0];
      if (first && (first.baseAsset || first.wartToAssetSwaps || first.assetToWartSwaps)) {
        assetGroups = rawData;
      } else {
        assetGroups = [{
          baseAsset: { name: 'Asset', hash: queriedAssetHash || 'unknown' },
          wartToAssetSwaps: rawData.filter((o) => o.isBuy !== false),
          assetToWartSwaps: rawData.filter((o) => o.isBuy === false),
        }];
      }
    } else if (rawData && typeof rawData === 'object' && (rawData.baseAsset || rawData.wartToAssetSwaps)) {
      assetGroups = [rawData];
    }

    if (assetGroups.length === 0) {
      return (
        <div className="mt-4 p-6 bg-zinc-950 border border-zinc-700 rounded-2xl text-center">
          <p className="text-zinc-300 font-medium text-sm">No open limit orders</p>
          <p className="text-xs text-zinc-500 mt-1">Your pending buy/sell orders will appear here.</p>
        </div>
      );
    }

    return (
      <div className="mt-4 space-y-3">
        {assetGroups.map((assetOrder, idx) => {
          const asset = assetOrder.baseAsset || {};
          const buyOrders = assetOrder.wartToAssetSwaps || [];
          const sellOrders = assetOrder.assetToWartSwaps || [];
          return (
            <div key={idx} className="bg-zinc-950 border border-zinc-700 rounded-2xl overflow-hidden">
              <div className="px-3 py-2 bg-zinc-900 border-b border-zinc-700 flex items-center justify-between">
                <span className="font-semibold text-white">{asset.name || 'Asset'}</span>
                {asset.hash && (
                  <button type="button" onClick={() => copyToClipboard(asset.hash)} className="font-mono text-[10px] text-purple-400">
                    {asset.hash.slice(0, 8)}…{asset.hash.slice(-6)}
                  </button>
                )}
              </div>
              <div className="p-3 space-y-2 text-sm">
                {buyOrders.slice(0, 5).map((order, oIdx) => (
                  <div key={`b${oIdx}`} className="bg-zinc-900 border border-zinc-700 rounded-xl p-2">
                    <span className={limitOrderBuyClasses.text}>
                      Buy @ <FormattedNumber value={order.limit?.doubleAdjusted || order.limit} overrides={{ maxDecimals: 8 }} />
                    </span>
                    <span className="text-zinc-500 ml-2 text-xs">
                      <FormattedNumber value={order.filled?.str || order.filled || '0'} variant="balance" />
                      {' / '}
                      <FormattedNumber value={order.amount?.str || order.amount || '0'} variant="balance" />
                    </span>
                  </div>
                ))}
                {sellOrders.slice(0, 5).map((order, oIdx) => (
                  <div key={`s${oIdx}`} className="bg-zinc-900 border border-zinc-700 rounded-xl p-2">
                    <span className={limitOrderSellClasses.text}>
                      Sell @ <FormattedNumber value={order.limit?.doubleAdjusted || order.limit} overrides={{ maxDecimals: 8 }} />
                    </span>
                    <span className="text-zinc-500 ml-2 text-xs">
                      <FormattedNumber value={order.filled?.str || order.filled || '0'} variant="balance" />
                      {' / '}
                      <FormattedNumber value={order.amount?.str || order.amount || '0'} variant="balance" />
                    </span>
                  </div>
                ))}
                {buyOrders.length === 0 && sellOrders.length === 0 && (
                  <div className="text-xs text-zinc-500">No orders in this group</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const swapDisabled = loading.swap || !assetHash;
  const submitLabel = (() => {
    if (loading.swap) return orderMode === 'market' ? 'Swapping…' : 'Placing order…';
    if (!selectedAsset) return 'Select a token';
    if (!payAmount) return 'Enter an amount';
    if (orderMode === 'limit' && !limitPrice) return 'Enter limit price';
    if (orderMode === 'market' && spotPrice == null && !marketLoading) return 'No pool price';
    if (orderMode === 'market') return payingWart ? 'Buy' : 'Sell';
    return payingWart ? 'Place buy limit' : 'Place sell limit';
  })();

  const pairLabel = selectedAsset?.symbol
    ? (payingWart ? `WART → ${selectedAsset.symbol}` : `${selectedAsset.symbol} → WART`)
    : 'Pick a token';

  // ==================== UI ====================
  return (
    <div className="swap-page w-full max-w-lg mx-auto">
      {/* Mode: Market | Limit — quiet pill tabs */}
      <div className="dex-tabs flex w-full gap-1.5 p-1 mb-5 bg-zinc-950/80 border border-zinc-800/80 rounded-full">
        {[
          { id: 'market', label: 'Market' },
          { id: 'limit', label: 'Limit' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setOrderMode(tab.id)}
            className={`dex-tab-btn${orderMode === tab.id ? ' dex-tab-btn--active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Swap card */}
      <div className="swap-card">
        <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3 border-b border-zinc-800/70">
          <div>
            <h2 className="text-base font-semibold tracking-tight !text-zinc-100 !mb-0.5">
              {orderMode === 'market' ? 'Swap' : 'Limit order'}
            </h2>
            <p className="text-[11px] text-zinc-600 tabular-nums">{pairLabel}</p>
          </div>
          <div className="text-right">
            {spotPrice != null ? (
              <div className="text-[11px] text-zinc-500 tabular-nums">
                <span className="text-zinc-600 block text-[10px] uppercase tracking-wide mb-0.5">Spot</span>
                <span className="text-zinc-300">
                  {formatAssetPrice(spotPrice, 8)}
                </span>
                <span className="text-zinc-600"> WART</span>
              </div>
            ) : marketLoading ? (
              <div className="text-[11px] text-zinc-600">Loading price…</div>
            ) : selectedAsset ? (
              <div className="text-[11px] text-zinc-600">No pool price</div>
            ) : null}
          </div>
        </div>

        {!selectedAsset && (
          <div className="swap-empty-banner mt-3">
            No tracked tokens yet. Add assets on <span className="text-zinc-300">Overview</span>,
            or open Advanced and paste an asset hash.
          </div>
        )}

        <div className="p-4 space-y-2">
          {/* You pay */}
          <div className="swap-panel">
            <div className="flex items-start justify-between gap-3 mb-2">
              <span className="text-xs text-zinc-500 shrink-0 pt-0.5">You pay</span>
              {displayPayAvailable && (
                <button
                  type="button"
                  onClick={fillMax}
                  className="swap-balance-btn"
                  title="Use available balance"
                >
                  <span className="text-zinc-500">Available </span>
                  <span className="text-zinc-300 tabular-nums">
                    <FormattedNumber value={displayPayAvailable.available} variant="balance" className="!text-zinc-300" />
                  </span>
                  <span className="text-zinc-500"> {displayPayAvailable.unit}</span>
                  {displayPayAvailable.hasLocked ? (
                    <span className="block text-[10px] text-zinc-600 mt-0.5">
                      Locked{' '}
                      <span className="text-amber-500/80 tabular-nums">
                        <FormattedNumber value={displayPayAvailable.locked} variant="balance" className="!text-amber-500/80" />
                      </span>
                    </span>
                  ) : null}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="0"
                className="flex-1 min-w-0 bg-transparent text-3xl font-semibold text-white outline-none placeholder:text-zinc-700 tracking-tight"
              />
              <button type="button" onClick={fillMax} className="swap-chip-btn">
                MAX
              </button>
              {payingWart ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-zinc-950/80 border border-zinc-700/80">
                  <span className="w-6 h-6 rounded-full bg-zinc-700 text-zinc-200 text-xs font-bold flex items-center justify-center">W</span>
                  <span className="font-semibold text-zinc-100 text-sm">WART</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowTokenPicker(true)}
                  className="swap-token-btn"
                >
                  <span className="w-6 h-6 rounded-full bg-zinc-700 text-zinc-200 text-xs font-bold flex items-center justify-center">
                    {(selectedAsset?.symbol || '?')[0]}
                  </span>
                  <span>{selectedAsset?.symbol || 'Select'}</span>
                  <span className="text-zinc-500 text-xs">▾</span>
                </button>
              )}
            </div>
          </div>

          {/* Flip */}
          <div className="flex justify-center -my-1 relative z-10">
            <button
              type="button"
              onClick={flipDirection}
              className="swap-flip-btn"
              title="Flip direction"
              aria-label="Flip swap direction"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
          </div>

          {/* You receive */}
          <div className="swap-panel">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-zinc-500">You receive</span>
              {orderMode === 'market' && (
                <span className="text-[10px] text-zinc-600">Estimate · {slippagePct}% slip</span>
              )}
              {orderMode === 'limit' && limitPrice && (
                <span className="text-[10px] text-zinc-600">At your limit</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 text-3xl font-semibold text-white tracking-tight tabular-nums">
                {receiveEstimate != null ? (
                  <FormattedNumber value={receiveEstimate} overrides={{ maxDecimals: 8 }} className="!text-white" />
                ) : (
                  <span className="text-zinc-700">0</span>
                )}
              </div>
              {!payingWart ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-zinc-950/80 border border-zinc-700/80">
                  <span className="w-6 h-6 rounded-full bg-zinc-700 text-zinc-200 text-xs font-bold flex items-center justify-center">W</span>
                  <span className="font-semibold text-zinc-100 text-sm">WART</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowTokenPicker(true)}
                  className="swap-token-btn"
                >
                  <span className="w-6 h-6 rounded-full bg-zinc-700 text-zinc-200 text-xs font-bold flex items-center justify-center">
                    {(selectedAsset?.symbol || '?')[0]}
                  </span>
                  <span>{selectedAsset?.symbol || 'Select'}</span>
                  <span className="text-zinc-500 text-xs">▾</span>
                </button>
              )}
            </div>
          </div>

          {/* Limit price field (limit mode only) */}
          {orderMode === 'limit' && (
            <div className="swap-panel">
              <label className="text-xs text-zinc-500 block mb-2">
                Limit price <span className="text-zinc-600">(WART per {selectedAsset?.symbol || 'token'})</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder={spotPrice != null ? formatAssetPrice(spotPrice, 8) : '0.0'}
                  className="flex-1 min-w-0 bg-transparent text-xl font-semibold text-white outline-none placeholder:text-zinc-700 tracking-tight"
                />
                {spotPrice != null && (
                  <button
                    type="button"
                    onClick={() => setLimitPrice(String(spotPrice))}
                    className="swap-chip-btn"
                  >
                    Use spot
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Summary */}
          <div className="swap-summary space-y-1.5 text-[11px] text-zinc-500">
            {orderMode === 'market' && effectiveLimitPrice != null && (
              <div className="flex justify-between gap-3">
                <span>Max price (slippage)</span>
                <span className="text-zinc-400 tabular-nums shrink-0">
                  {formatAssetPrice(effectiveLimitPrice, 8)} WART
                </span>
              </div>
            )}
            {orderMode === 'limit' && effectiveLimitPrice != null && (
              <div className="flex justify-between gap-3">
                <span>Your limit</span>
                <span className="text-zinc-400 tabular-nums shrink-0">
                  {formatAssetPrice(effectiveLimitPrice, 8)} / {selectedAsset?.symbol || 'token'}
                </span>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <span>Network fee</span>
              <span className="text-zinc-400 tabular-nums shrink-0">{txFee || suggestedTxFee} WART</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSwap}
            disabled={swapDisabled || submitLabel === 'Select a token' || submitLabel === 'Enter an amount' || submitLabel === 'Enter limit price' || submitLabel === 'No pool price'}
            className="swap-cta-btn"
          >
            {submitLabel}
          </button>

          {results.swap && renderTransactionResult(
            results.swap,
            orderMode === 'market'
              ? (payingWart ? 'Market Buy' : 'Market Sell')
              : (payingWart ? 'Limit Buy' : 'Limit Sell'),
          )}
        </div>
      </div>

      <p className="swap-hint">
        {orderMode === 'market'
          ? 'Market uses pool spot ± slippage so the order can fill right away.'
          : 'Limit rests on the book until matched. Locked balance frees when filled or cancelled.'}
      </p>

      {/* Advanced */}
      <div className="swap-advanced">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="swap-advanced-btn"
          aria-expanded={showAdvanced}
        >
          <span className={`swap-advanced-chevron${showAdvanced ? ' is-open' : ''}`} aria-hidden>
            ▶
          </span>
          <span className="flex-1 text-left">
            <span className="block font-medium text-zinc-300 text-sm">Advanced</span>
            <span className="block text-[11px] text-zinc-600 mt-0.5">
              Fee, slippage, liquidity, hashes &amp; pool tools
            </span>
          </span>
          <span className="text-[11px] text-zinc-600 shrink-0">{showAdvanced ? 'Hide' : 'Show'}</span>
        </button>

        {showAdvanced && (
          <div className="px-3 sm:px-4 pb-4 border-t border-zinc-800/80 space-y-3 pt-3">
            {/* Trade settings */}
            <div className="swap-adv-section">
              <div className="swap-adv-title">
                <span className="swap-adv-title-dot" />
                Trade settings
              </div>

              {orderMode === 'market' && (
                <div className="swap-adv-field">
                  <span className="swap-adv-label">Slippage tolerance</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {[1, 3, 5, 10].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSlippagePct(String(s))}
                        className={`swap-chip-btn${String(slippagePct) === String(s) ? ' swap-chip-btn--active' : ''}`}
                      >
                        {s}%
                      </button>
                    ))}
                    <input
                      type="text"
                      inputMode="decimal"
                      value={slippagePct}
                      onChange={(e) => setSlippagePct(e.target.value)}
                      className="input !mb-0 w-20 text-sm"
                      aria-label="Custom slippage percent"
                    />
                  </div>
                  <p className="swap-adv-hint">How far past spot you accept so a market order can fill.</p>
                </div>
              )}

              <div className="swap-adv-field">
                <span className="swap-adv-label">Network fee (WART)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={txFee}
                  onChange={(e) => setTxFee(e.target.value)}
                  className="input !mb-0 text-sm"
                />
                <p className="swap-adv-hint">{feeHint}</p>
              </div>

              <div className="swap-adv-field">
                <span className="swap-adv-label">Nonce override <span className="text-zinc-600 font-normal">(optional)</span></span>
                <input
                  type="number"
                  value={nonceOverride}
                  onChange={(e) => setNonceOverride(e.target.value)}
                  placeholder="Leave empty for auto"
                  className="input !mb-0 text-sm"
                />
                <p className="swap-adv-hint">Only if you hit a duplicate-nonce error.</p>
              </div>

              <div className="swap-adv-field">
                <span className="swap-adv-label">Asset hash</span>
                <div className="swap-input-row">
                  <input
                    type="text"
                    value={manualHashInput}
                    onChange={(e) => setManualHashInput(e.target.value)}
                    placeholder="64 hex characters"
                    className="input !mb-0 font-mono text-xs"
                  />
                  <button type="button" onClick={applyManualHash} className="swap-chip-btn">
                    Use
                  </button>
                </div>
                <p className="swap-adv-hint">
                  Tokens in the picker come from Overview tracked assets. Paste any hash here to trade a pool that isn’t tracked yet.
                </p>
              </div>

              <div className="swap-adv-field">
                <span className="swap-adv-label">Token decimals</span>
                <input
                  type="number"
                  value={assetDecimals}
                  onChange={(e) => setAssetDecimals(parseInt(e.target.value, 10) || 8)}
                  className="input !mb-0 text-sm w-28"
                />
                <p className="swap-adv-hint">Usually filled from the market; override only if encoding looks wrong.</p>
              </div>
            </div>

            {/* Tools */}
            <div className="swap-adv-section swap-adv-tools">
              <div className="swap-adv-title">
                <span className="swap-adv-title-dot" />
                Tools
              </div>

              <div className="dex-tabs flex w-full gap-1 p-1 overflow-x-auto scrollbar-hide">
                {[
                  { id: 'orders', label: 'Orders' },
                  { id: 'liquidity', label: 'Liquidity' },
                  { id: 'pool', label: 'Pool' },
                  { id: 'market', label: 'Market' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setAdvancedSubTab(t.id)}
                    className={`dex-tab-btn whitespace-nowrap${advancedSubTab === t.id ? ' dex-tab-btn--active' : ''}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {advancedSubTab === 'orders' && (
                <div className="swap-adv-pane space-y-3">
                  <p className="lead">View open limit orders for this wallet (or a single asset).</p>
                  <div className="swap-adv-actions">
                    <button
                      type="button"
                      onClick={() => query('openOrders', `account/${account}/open_orders`)}
                      disabled={loading.openOrders || !account}
                      className="swap-chip-btn"
                    >
                      {loading.openOrders ? 'Loading…' : 'All open orders'}
                    </button>
                  </div>
                  {results.openOrders && renderOpenOrdersCompact(results.openOrders)}
                  <div className="swap-adv-field !mb-0">
                    <span className="swap-adv-label">Orders for asset</span>
                    <div className="swap-input-row">
                      <input id="assetForOrders" placeholder="asset hash" defaultValue={assetHash} className="input !mb-0 font-mono text-xs" />
                      <button
                        type="button"
                        onClick={() => query(
                          'openOrdersAsset',
                          `account/${account}/open_orders/${encodeURIComponent(document.getElementById('assetForOrders').value)}`,
                        )}
                        disabled={!account}
                        className="swap-chip-btn"
                      >
                        Query
                      </button>
                    </div>
                  </div>
                  {results.openOrdersAsset && renderOpenOrdersCompact(
                    results.openOrdersAsset,
                    document.getElementById('assetForOrders')?.value?.trim(),
                  )}
                </div>
              )}

              {advancedSubTab === 'liquidity' && (
                <div className="swap-adv-pane">
                  <div className="flex gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setLiquidityMode('deposit')}
                      className={`swap-chip-btn${liquidityMode === 'deposit' ? ' swap-chip-btn--active' : ''}`}
                    >
                      Deposit
                    </button>
                    <button
                      type="button"
                      onClick={() => setLiquidityMode('withdraw')}
                      className={`swap-chip-btn${liquidityMode === 'withdraw' ? ' swap-chip-btn--active' : ''}`}
                    >
                      Withdraw
                    </button>
                  </div>

                  {liquidityMode === 'deposit' ? (
                    <div className="space-y-2">
                      <p className="lead">Add asset + WART to the pool and receive LP shares.</p>
                      <input id="liquidityAssetHash" defaultValue={assetHash} placeholder="Asset hash" className="input font-mono text-xs" />
                      <input id="liquidityAssetAmount" type="number" step="any" placeholder="Asset amount" className="input" />
                      <input id="liquidityDecimals" type="number" defaultValue={assetDecimals} placeholder="Decimals" className="input" />
                      <input id="liquidityWartAmount" type="number" step="any" placeholder="WART amount" className="input" />
                      <input id="liquidityDepositFee" type="text" inputMode="decimal" defaultValue={suggestedTxFee} placeholder="Fee (WART)" className="input" />
                      <input id="liquidityNonceOverride" type="number" placeholder="Nonce override (optional)" className="input" />
                      <div className="swap-adv-actions">
                        <button
                          type="button"
                          onClick={handleLiquidityDeposit}
                          disabled={loading.liquidityDeposit}
                          className="swap-chip-btn"
                        >
                          {loading.liquidityDeposit ? 'Depositing…' : 'Deposit liquidity'}
                        </button>
                      </div>
                      {results.liquidityDeposit && renderTransactionResult(results.liquidityDeposit, 'Liquidity Deposit')}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="lead">Redeem LP shares for underlying asset + WART.</p>
                      <input id="liquidityWithdrawAssetHash" defaultValue={assetHash || poolAssetHash} placeholder="Asset hash" className="input font-mono text-xs" />
                      <input id="liquidityWithdrawShares" type="number" step="any" placeholder="LP shares" className="input" />
                      <input id="liquidityWithdrawFee" type="text" inputMode="decimal" defaultValue={suggestedTxFee} placeholder="Fee (WART)" className="input" />
                      <input id="liquidityWithdrawNonceOverride" type="number" placeholder="Nonce override (optional)" className="input" />
                      <div className="swap-adv-actions">
                        <button type="button" onClick={fillWithdrawFromLpBalance} className="swap-chip-btn">
                          Fill from position
                        </button>
                        <button
                          type="button"
                          onClick={handleLiquidityWithdraw}
                          disabled={loading.liquidityWithdraw}
                          className="swap-chip-btn"
                        >
                          {loading.liquidityWithdraw ? 'Withdrawing…' : 'Withdraw liquidity'}
                        </button>
                      </div>
                      {results.liquidityWithdraw && renderTransactionResult(results.liquidityWithdraw, 'Liquidity Withdrawal')}
                    </div>
                  )}
                </div>
              )}

              {advancedSubTab === 'pool' && (
                <div className="swap-adv-pane space-y-3">
                  <p className="lead">Load reserves, spot, and your LP shares for a pool.</p>
                  <div className="swap-adv-field !mb-0">
                    <span className="swap-adv-label">Pool asset hash</span>
                    <div className="swap-input-row">
                      <input
                        id="poolAssetHash"
                        value={poolAssetHash || assetHash}
                        onChange={(e) => setPoolAssetHash(e.target.value)}
                        placeholder="64 hex chars"
                        className="input !mb-0 font-mono text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => loadPoolAndPosition()}
                        disabled={loading.poolMarket}
                        className="swap-chip-btn"
                      >
                        {loading.poolMarket ? '…' : 'Load'}
                      </button>
                    </div>
                  </div>
                  {results.poolMarket && renderPoolMarketCard(results.poolMarket)}
                  {results.myLiquidityBalance && renderLiquiditySharesCard(results.myLiquidityBalance)}

                  {results.poolMarket?.code === 0 && (
                    <div className="pt-1 border-t border-zinc-800/80">
                      <div className="flex gap-2 mb-3 mt-3">
                        <button
                          type="button"
                          onClick={() => setPositionPoolMode('deposit')}
                          className={`swap-chip-btn${positionPoolMode === 'deposit' ? ' swap-chip-btn--active' : ''}`}
                        >
                          Deposit
                        </button>
                        <button
                          type="button"
                          onClick={() => setPositionPoolMode('withdraw')}
                          className={`swap-chip-btn${positionPoolMode === 'withdraw' ? ' swap-chip-btn--active' : ''}`}
                        >
                          Withdraw
                        </button>
                      </div>
                      {positionPoolMode === 'deposit' ? (
                        <div className="space-y-2">
                          <input id="positionPoolAssetAmount" type="number" step="any" placeholder="Asset amount" className="input" />
                          <input id="positionPoolDecimals" type="number" defaultValue={results.poolMarket?.data?.baseAsset?.decimals ?? assetDecimals} className="input" />
                          <input id="positionPoolWartAmount" type="number" step="any" placeholder="WART amount" className="input" />
                          <input id="positionPoolDepositFee" type="text" inputMode="decimal" defaultValue={suggestedTxFee} className="input" />
                          <input id="positionPoolNonceOverride" type="number" placeholder="Nonce override" className="input" />
                          <div className="swap-adv-actions">
                            <button
                              type="button"
                              onClick={handlePositionPoolDeposit}
                              disabled={loading.liquidityDeposit}
                              className="swap-chip-btn"
                            >
                              {loading.liquidityDeposit ? 'Depositing…' : 'Deposit into pool'}
                            </button>
                          </div>
                          {results.liquidityDeposit && renderTransactionResult(results.liquidityDeposit, 'Liquidity Deposit')}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <button type="button" onClick={fillWithdrawFromLpBalance} className="swap-chip-btn">
                            Fill withdraw form from LP balance
                          </button>
                          <p className="swap-adv-hint">Then switch to Liquidity → Withdraw to redeem.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {advancedSubTab === 'market' && (
                <div className="swap-adv-pane space-y-3">
                  <p className="lead">Query raw market data for any asset pool.</p>
                  <div className="swap-adv-field !mb-0">
                    <span className="swap-adv-label">Market / asset hash</span>
                    <div className="swap-input-row">
                      <input id="market" defaultValue={assetHash} placeholder="asset hash" className="input !mb-0 font-mono text-xs" />
                      <button
                        type="button"
                        onClick={() => query('dexMarket', `dex/market/${encodeURIComponent(document.getElementById('market').value)}`)}
                        disabled={loading.dexMarket}
                        className="swap-chip-btn"
                      >
                        {loading.dexMarket ? '…' : 'Query'}
                      </button>
                    </div>
                  </div>
                  {results.dexMarket && renderPoolMarketCard(results.dexMarket)}
                  {marketInfo && !results.dexMarket && (
                    <p className="swap-adv-hint">
                      The pair above already has live spot from this pool.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Token picker modal */}
      {showTokenPicker && (
        <div className="modal-overlay swap-page" style={{ zIndex: 1100 }} onClick={() => setShowTokenPicker(false)}>
          <div className="modal-content max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-1 !text-zinc-100">Select token</h2>
            <p className="text-xs text-zinc-500 mb-4 leading-relaxed">
              Shows assets you’ve tracked on Overview (with a fetched balance).
              Warthog pools are always <span className="text-zinc-400">token ↔ WART</span>.
            </p>

            {tokenOptions.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 text-sm text-zinc-400 mb-4 leading-relaxed">
                No tracked assets yet. On Overview, add a token by hash, or paste a hash below / in Advanced.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto mb-4">
                {tokenOptions.map((t) => (
                  <button
                    key={t.hash}
                    type="button"
                    onClick={() => selectToken(t)}
                    className={`swap-token-row${selectedAsset?.hash === t.hash ? ' swap-token-row--active' : ''}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-8 h-8 rounded-full bg-zinc-700 text-zinc-200 text-sm font-bold flex items-center justify-center flex-shrink-0">
                        {t.symbol[0]}
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold text-white truncate">{t.symbol}</div>
                        <div className="font-mono text-[10px] text-zinc-500 truncate">{t.hash.slice(0, 12)}…</div>
                      </div>
                    </div>
                    <div className="text-right text-xs tabular-nums text-zinc-400 flex-shrink-0 ml-2">
                      <FormattedNumber value={t.available} variant="balance" className="!text-zinc-400" />
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="border-t border-zinc-800 pt-3">
              <label className="block text-xs text-zinc-400 mb-1">Or paste asset hash</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualHashInput}
                  onChange={(e) => setManualHashInput(e.target.value)}
                  placeholder="64 hex characters"
                  className="input !mb-0 flex-1 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    applyManualHash();
                    setShowTokenPicker(false);
                  }}
                  className="swap-chip-btn"
                >
                  Use
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowTokenPicker(false)}
              className="swap-cta-btn !mt-4"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DexPage;
