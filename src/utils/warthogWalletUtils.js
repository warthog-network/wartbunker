import CryptoJS from 'crypto-js';
import { ensureBuffer } from './ensureBuffer.js';

export const encryptWallet = (walletData, password) => {
  const { privateKey, publicKey, address } = walletData;
  return CryptoJS.AES.encrypt(JSON.stringify({ privateKey, publicKey, address }), password).toString();
};

export const decryptWallet = (encrypted, password) => {
  const bytes = CryptoJS.AES.decrypt(encrypted, password);
  const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
  if (!decryptedStr) throw new Error('Invalid password');
  return JSON.parse(decryptedStr);
};

function normalizeStoredHex(value) {
  if (value == null) return null;
  const clean = String(value).trim().replace(/^0x/i, '');
  return clean || null;
}

/** Normalize decrypted wallet fields and derive missing address/publicKey from the private key. */
export async function normalizeDecryptedWallet(wallet) {
  const rawPrivateKey = wallet?.privateKey ?? wallet?.private_key;
  if (!rawPrivateKey) {
    throw new Error('Decrypted wallet is missing a private key');
  }

  const privateKey = String(rawPrivateKey).trim().replace(/^0x/i, '');
  if (privateKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(privateKey)) {
    throw new Error('Invalid private key in wallet data');
  }

  const storedAddress = normalizeStoredHex(wallet?.address);
  const storedPublicKey = normalizeStoredHex(wallet?.publicKey ?? wallet?.public_key);

  // Saved wallets already include address/publicKey — avoid re-deriving via warthog-js
  // (worker/browser crypto can fail on redundant Account.fromPrivateKeyHex calls).
  if (storedAddress && storedPublicKey) {
    return {
      privateKey,
      publicKey: storedPublicKey,
      address: storedAddress,
    };
  }

  await ensureBuffer();
  const { Account } = await import('warthog-js');
  const account = Account.fromPrivateKeyHex(privateKey);

  const address = storedAddress || account.address?.hex;
  if (!address) {
    throw new Error('Could not derive wallet address');
  }

  return {
    privateKey: account.privateKeyHex || privateKey,
    publicKey: storedPublicKey || account.publicKeyHex,
    address,
  };
}

/** Derive a Warthog address from a public key hex (compressed or uncompressed). */
export async function deriveWarthogAddress(publicKeyHex) {
  if (!publicKeyHex) return null;
  const { Address } = await import('warthog-js');
  return Address.fromPublicKeyHex(publicKeyHex)?.hex ?? null;
}

export const downloadWallet = (walletData, password) => {
  const encrypted = encryptWallet(walletData, password);
  const blob = new Blob([encrypted], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'warthog_wallet.txt';
  a.click();
  URL.revokeObjectURL(url);
};