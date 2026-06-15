import '../shims/browserPolyfills.js';
import { ensureBuffer } from './ensureBuffer.js';
import { serializeTransaction } from './warthogTx.js';

/**
 * Build and sign a WART transfer using warthog-js (browser-only).
 */
export async function buildWartTransfer({
  privateKey,
  toAddress,
  amount,
  nonce,
  pinHash,
  pinHeight,
  minFeeE8,
}) {
  await ensureBuffer();

  const {
    Account,
    Address,
    NonceId,
    RoundedFee,
    TransactionContext,
    Wart,
  } = await import('warthog-js');

  const trimmed = toAddress.trim().replace(/^0x/i, '');
  const recipient = Address.fromHex(trimmed) ?? Address.fromRaw(trimmed);
  if (!recipient) {
    throw new Error('Invalid recipient address (expected 40 or 48 hex chars with valid checksum)');
  }

  const wartAmount = Wart.parse(amount);
  if (!wartAmount) {
    throw new Error('Invalid amount');
  }

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

  const account = Account.fromPrivateKeyHex(privateKey);
  return {
    payload: serializeTransaction(ctx.transferWart(account, recipient, wartAmount)),
    nonce: nonceId.value,
  };
}