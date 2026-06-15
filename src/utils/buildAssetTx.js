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

function parseRecipientAddress(Address, raw) {
  const trimmed = raw.trim().replace(/^0x/i, '');
  return Address.fromHex(trimmed) ?? Address.fromRaw(trimmed);
}

/** Build and sign an asset creation transaction. */
export async function buildAssetCreation({
  privateKey,
  name,
  supply,
  decimals,
  nonce,
  pinHash,
  pinHeight,
  minFeeE8,
}) {
  const assetName = name.trim().toUpperCase();
  if (!assetName || assetName.length > 5) {
    throw new Error('Asset name must be 1-5 characters');
  }

  const precisionValue = Math.min(Math.max(parseInt(decimals, 10) || 8, 0), 18);
  const { ctx, nonceId, Account } = await createSigningContext({
    pinHash,
    pinHeight,
    minFeeE8,
    nonce,
  });

  const { Funds, TokenPrecision } = await import('warthog-js');
  const precision = new TokenPrecision(precisionValue);
  const totalSupply = Funds.parse(String(supply).trim(), precision);
  if (!totalSupply) {
    throw new Error('Invalid total supply');
  }

  const account = Account.fromPrivateKeyHex(privateKey);
  return {
    payload: serializeTransaction(ctx.createAssets(account, totalSupply, precision, assetName)),
    nonce: nonceId.value,
  };
}

/** Build and sign a token or liquidity transfer transaction. */
export async function buildAssetTransfer({
  privateKey,
  assetHash,
  toAddress,
  amount,
  decimals,
  isLiquidity,
  nonce,
  pinHash,
  pinHeight,
  minFeeE8,
}) {
  const hash = assetHash.trim().replace(/^0x/i, '').toLowerCase();
  if (!isValidAssetHash(hash)) {
    throw new Error('Asset hash must be exactly 64 hex characters');
  }

  const { ctx, nonceId, Account } = await createSigningContext({
    pinHash,
    pinHeight,
    minFeeE8,
    nonce,
  });

  const { Address, Funds, Liquidity, TokenPrecision } = await import('warthog-js');
  const recipient = parseRecipientAddress(Address, toAddress);
  if (!recipient) {
    throw new Error('Invalid recipient address');
  }

  const account = Account.fromPrivateKeyHex(privateKey);
  const amountStr = String(amount).trim();

  const tx = isLiquidity
    ? (() => {
        const units = Liquidity.parse(amountStr);
        if (!units) throw new Error('Invalid liquidity amount');
        return ctx.transferLiquidity(account, hash, recipient, units);
      })()
    : (() => {
        const precision = new TokenPrecision(Math.min(Math.max(parseInt(decimals, 10) || 8, 0), 18));
        const tokenAmount = Funds.parse(amountStr, precision);
        if (!tokenAmount) throw new Error('Invalid token amount');
        return ctx.transferAsset(account, hash, recipient, tokenAmount);
      })();

  return {
    payload: serializeTransaction(tx),
    nonce: nonceId.value,
  };
}