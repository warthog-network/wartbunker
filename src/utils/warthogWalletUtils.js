import CryptoJS from 'crypto-js';
import { ensureBuffer } from './ensureBuffer.js';
import {
  tryParseEnvelope,
  getPasswordCipherFromBlob,
  inspectWalletBlob,
} from './passkeyWallet.js';

/** Envelope version for password-based wallet blobs. */
export const WALLET_CRYPTO_VERSION = 2;

/** PBKDF2 iterations (SHA-256). Higher = slower brute-force, still interactive on save/login. */
const PBKDF2_ITERATIONS = 210_000;

/**
 * Encrypt wallet material for browser storage or portable file.
 * v2 uses PBKDF2-SHA256 + AES-CBC (not OpenSSL EVP_BytesToKey).
 */
export const encryptWallet = (walletData, password) => {
  if (password == null || String(password).length === 0) {
    throw new Error('Password is required');
  }
  const { privateKey, publicKey, address } = walletData;
  const plaintext = JSON.stringify({ privateKey, publicKey, address });

  const salt = CryptoJS.lib.WordArray.random(16);
  const iv = CryptoJS.lib.WordArray.random(16);
  const key = CryptoJS.PBKDF2(String(password), salt, {
    keySize: 256 / 32,
    iterations: PBKDF2_ITERATIONS,
    hasher: CryptoJS.algo.SHA256,
  });

  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  return JSON.stringify({
    v: WALLET_CRYPTO_VERSION,
    kdf: 'pbkdf2-sha256',
    iter: PBKDF2_ITERATIONS,
    salt: CryptoJS.enc.Base64.stringify(salt),
    iv: CryptoJS.enc.Base64.stringify(iv),
    ct: CryptoJS.enc.Base64.stringify(encrypted.ciphertext),
  });
};

function decryptV2(envelope, password) {
  const iterations = Number(envelope.iter) > 0 ? Number(envelope.iter) : PBKDF2_ITERATIONS;
  const salt = CryptoJS.enc.Base64.parse(envelope.salt);
  const iv = CryptoJS.enc.Base64.parse(envelope.iv);
  const ciphertext = CryptoJS.enc.Base64.parse(envelope.ct);

  const key = CryptoJS.PBKDF2(String(password), salt, {
    keySize: 256 / 32,
    iterations,
    hasher: CryptoJS.algo.SHA256,
  });

  const decrypted = CryptoJS.AES.decrypt({ ciphertext }, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  const decryptedStr = decrypted.toString(CryptoJS.enc.Utf8);
  if (!decryptedStr) throw new Error('Invalid password');
  return JSON.parse(decryptedStr);
}

/** Legacy CryptoJS OpenSSL-compatible decrypt (pre-v2 saved wallets / files). */
function decryptLegacyOpenSsl(encrypted, password) {
  const bytes = CryptoJS.AES.decrypt(String(encrypted), String(password));
  const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
  if (!decryptedStr) throw new Error('Invalid password');
  return JSON.parse(decryptedStr);
}

/**
 * Decrypt a wallet blob. Supports:
 * - multi-auth envelope (warthog-wallet-v1) → password field
 * - v2 JSON envelope (PBKDF2)
 * - legacy CryptoJS AES+passphrase (OpenSSL salted format)
 *
 * Existing browser saves and warthog_wallet.txt files keep working.
 */
export const decryptWallet = (encrypted, password) => {
  if (password == null || String(password).length === 0) {
    throw new Error('Invalid password');
  }
  const raw = String(encrypted ?? '').trim();
  if (!raw) throw new Error('Invalid password');

  // Multi-auth (passkey + optional password) — decrypt the password cipher only
  const multi = tryParseEnvelope(raw);
  if (multi) {
    if (!multi.password) {
      throw new Error('This wallet has no password — unlock with fingerprint instead');
    }
    return decryptWallet(multi.password, password);
  }

  // v2 password envelope
  if (raw.startsWith('{')) {
    try {
      const envelope = JSON.parse(raw);
      if (envelope && Number(envelope.v) === 2 && envelope.ct && envelope.salt && envelope.iv) {
        return decryptV2(envelope, password);
      }
    } catch (err) {
      if (err?.message === 'Invalid password') throw err;
      // Not a valid v2 envelope — fall through to legacy if it was false-positive "{"
      if (err instanceof SyntaxError) {
        // continue to legacy
      } else if (err?.name === 'SyntaxError') {
        // continue
      } else {
        // JSON parsed but decrypt/parse of inner failed
        throw err;
      }
    }
  }

  return decryptLegacyOpenSsl(raw, password);
};

/** Re-export blob inspection for login UI badges. */
export { inspectWalletBlob, getPasswordCipherFromBlob };

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
