import { serializeTransaction } from './warthogTx.js';
import { isValidAssetHash } from './warthogFormat.js';
import { normalizeAssetHash } from './warthogClient.js';

/** Build and serialize a liquidity deposit transaction. */
export async function buildLiquidityDepositTx(ctx, account, {
  assetHash,
  assetAmount,
  decimals,
  wartAmount,
}) {
  const hash = normalizeAssetHash(assetHash);
  if (!isValidAssetHash(hash)) {
    throw new Error('Asset hash must be exactly 64 hex characters');
  }

  const { Funds, TokenPrecision, Wart } = await import('warthog-js');
  const precision = new TokenPrecision(Math.min(Math.max(parseInt(decimals, 10) || 8, 0), 18));
  const tokenAmount = Funds.parse(String(assetAmount).trim().replace(',', '.'), precision);
  if (!tokenAmount) {
    throw new Error('Invalid asset amount');
  }

  const wart = Wart.parse(String(wartAmount).trim().replace(',', '.'));
  if (!wart) {
    throw new Error('Invalid WART amount');
  }

  return serializeTransaction(ctx.depositLiquidity(account, hash, tokenAmount, wart));
}

/** Build and serialize a liquidity withdrawal transaction. */
export async function buildLiquidityWithdrawTx(ctx, account, {
  assetHash,
  shares,
}) {
  const hash = normalizeAssetHash(assetHash);
  if (!isValidAssetHash(hash)) {
    throw new Error('Asset hash must be exactly 64 hex characters');
  }

  const { Liquidity } = await import('warthog-js');
  const units = Liquidity.parse(String(shares).trim().replace(',', '.'));
  if (!units) {
    throw new Error('Invalid LP shares amount');
  }

  return serializeTransaction(ctx.withdrawLiquidity(account, hash, units));
}

/** Build and serialize a limit buy or sell transaction. */
export async function buildLimitSwapTx(ctx, account, {
  assetHash,
  isBuy,
  amount,
  assetDecimals,
  limitHex,
}) {
  const hash = normalizeAssetHash(assetHash);
  if (!isValidAssetHash(hash)) {
    throw new Error('Asset hash must be exactly 64 hex characters');
  }

  const { Funds, TokenPrecision, Wart, Price } = await import('warthog-js');
  const limit = Price.fromHex(limitHex.trim().replace(/^0x/i, '').toLowerCase());
  if (!limit) {
    throw new Error('Limit price must be exactly 6 hex characters');
  }

  const amountStr = String(amount).trim().replace(',', '.');

  const tx = isBuy
    ? (() => {
        const wartAmount = Wart.parse(amountStr);
        if (!wartAmount) throw new Error('Invalid WART amount');
        return ctx.buy(account, hash, wartAmount, limit);
      })()
    : (() => {
        const precision = new TokenPrecision(Math.min(Math.max(parseInt(assetDecimals, 10) || 8, 0), 18));
        const tokenAmount = Funds.parse(amountStr, precision);
        if (!tokenAmount) throw new Error('Invalid token amount');
        return ctx.sell(account, hash, tokenAmount, limit);
      })();

  return serializeTransaction(tx);
}