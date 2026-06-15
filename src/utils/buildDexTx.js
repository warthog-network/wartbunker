import '../shims/browserPolyfills.js';
import { ensureBuffer } from './ensureBuffer.js';
import { serializeTransaction } from './warthogTx.js';
import { isValidAssetHash } from './warthogFormat.js';

async function createSigningContext({ pinHash, pinHeight, minFeeE8, nonce }) {
  await ensureBuffer();

  const {
    Account,
    NonceId,
    RoundedFee,
    TransactionContext,
  } = await import('warthog-js');

  const nonceId = NonceId.fromNumber(parseInt(nonce, 10) || 0);
  if (!nonceId) {
    throw new Error('Invalid nonce');
  }

  const fee = RoundedFee.fromE8(BigInt(minFeeE8), true);
  if (!fee) {
    throw new Error('Invalid fee from node');
  }

  const ctx = new TransactionContext(
    {
      pinHash: pinHash || '0000000000000000000000000000000000000000000000000000000000000000',
      pinHeight: pinHeight || 0,
    },
    fee,
    nonceId,
  );

  return { ctx, nonceId, Account };
}

function normalizeHash(raw) {
  return raw.trim().replace(/^0x/i, '').toLowerCase();
}

/** Build and sign a liquidity deposit transaction. */
export async function buildLiquidityDeposit({
  privateKey,
  assetHash,
  assetAmount,
  decimals,
  wartAmount,
  nonce,
  pinHash,
  pinHeight,
  minFeeE8,
}) {
  const hash = normalizeHash(assetHash);
  if (!isValidAssetHash(hash)) {
    throw new Error('Asset hash must be exactly 64 hex characters');
  }

  const { ctx, nonceId, Account } = await createSigningContext({
    pinHash,
    pinHeight,
    minFeeE8,
    nonce,
  });

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

  const account = Account.fromPrivateKeyHex(privateKey);
  return {
    payload: serializeTransaction(ctx.depositLiquidity(account, hash, tokenAmount, wart)),
    nonce: nonceId.value,
  };
}

/** Build and sign a limit buy or sell transaction. */
export async function buildLimitSwap({
  privateKey,
  assetHash,
  isBuy,
  amount,
  assetDecimals,
  limitHex,
  nonce,
  pinHash,
  pinHeight,
  minFeeE8,
}) {
  const hash = normalizeHash(assetHash);
  if (!isValidAssetHash(hash)) {
    throw new Error('Asset hash must be exactly 64 hex characters');
  }

  const { ctx, nonceId, Account } = await createSigningContext({
    pinHash,
    pinHeight,
    minFeeE8,
    nonce,
  });

  const { Funds, TokenPrecision, Wart, Price } = await import('warthog-js');
  const limit = Price.fromHex(normalizeHash(limitHex));
  if (!limit) {
    throw new Error('Limit price must be exactly 6 hex characters');
  }
  const account = Account.fromPrivateKeyHex(privateKey);
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

  return {
    payload: serializeTransaction(tx),
    nonce: nonceId.value,
  };
}