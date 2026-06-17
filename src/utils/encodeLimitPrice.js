import { ensureBuffer } from './ensureBuffer.js';

/** Encode a human limit price to the 6-char hex the node expects (client-side, no API call). */
export async function encodeLimitPriceHex(priceStr, decimals = 8, { ceil = false } = {}) {
  await ensureBuffer();

  const normalized = String(priceStr).trim().replace(',', '.');
  const price = parseFloat(normalized);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Please enter a valid price greater than 0');
  }

  const { Price, TokenPrecision } = await import('warthog-js');
  const precisionValue = Math.min(Math.max(parseInt(decimals, 10) || 8, 0), 18);
  const prec = new TokenPrecision(precisionValue);

  const encoded = Price.fromNumberPrecision(price, prec, ceil);
  if (!encoded) {
    throw new Error('Price is out of encodable range');
  }

  const hex = encoded.toHex();
  if (hex.length !== 6) {
    throw new Error('Invalid encoded price length');
  }

  return hex;
}