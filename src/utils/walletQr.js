/** Prefix for encrypted wallet export QR codes (mobile app import). */
export const WALLET_QR_PREFIX = 'wartwallet:';

/** Safe upper bound for a single QR at error-correction level M. */
export const WALLET_QR_MAX_LENGTH = 2200;

export function encodeWalletQrPayload(encrypted) {
  return `${WALLET_QR_PREFIX}${encrypted}`;
}

export function parseWalletQrPayload(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith(WALLET_QR_PREFIX)) {
    const payload = trimmed.slice(WALLET_QR_PREFIX.length).trim();
    return payload || null;
  }

  // Raw CryptoJS AES blob (starts with "Salted__" in base64)
  if (/^U2FsdGVkX1[\w+/=]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function isWalletQrPayload(raw) {
  return parseWalletQrPayload(raw) != null;
}

export function getWalletQrCapacityError(encrypted) {
  const payload = encodeWalletQrPayload(encrypted);
  if (payload.length > WALLET_QR_MAX_LENGTH) {
    return `Encrypted wallet is too large for one QR (${payload.length} chars). Download the wallet file instead.`;
  }
  return null;
}