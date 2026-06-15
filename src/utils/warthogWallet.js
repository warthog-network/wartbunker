import { ensureBuffer } from './ensureBuffer.js';

function accountToWalletData(account, extra = {}) {
  return {
    ...extra,
    privateKey: account.privateKeyHex,
    publicKey: account.publicKeyHex,
    address: account.address.hex,
  };
}

async function deriveAccountFromMnemonic(mnemonic, pathType) {
  await ensureBuffer();
  const { HDWallet, Account } = await import('warthog-js');

  if (pathType === 'hardened') {
    const { ethers } = await import('ethers');
    const root = ethers.HDNodeWallet.fromPhrase(mnemonic, '', "m/44'/2070'/0'");
    const child = root.derivePath('0/0');
    return Account.fromPrivateKeyHex(child.privateKey.slice(2));
  }

  const hd = HDWallet.fromMnemonic(mnemonic);
  return hd.deriveAccountAtIndex(0);
}

/** Create a new wallet with a fresh mnemonic. */
export async function generateWallet(wordCount, pathType) {
  const { ethers } = await import('ethers');
  const strength = Number(wordCount) === 12 ? 128 : 256;
  const entropy = ethers.randomBytes(strength / 8);
  const mnemonic = ethers.Mnemonic.fromEntropy(entropy).phrase;
  const account = await deriveAccountFromMnemonic(mnemonic, pathType);

  return accountToWalletData(account, {
    mnemonic,
    wordCount: Number(wordCount),
    pathType,
  });
}

/** Restore a wallet from an existing mnemonic. */
export async function deriveWallet(mnemonicPhrase, wordCount, pathType) {
  const account = await deriveAccountFromMnemonic(mnemonicPhrase.trim(), pathType);

  return accountToWalletData(account, {
    mnemonic: mnemonicPhrase.trim(),
    wordCount: Number(wordCount),
    pathType,
  });
}

/** Import a wallet from a raw private key. */
export async function importFromPrivateKey(privKey) {
  const clean = privKey.trim().replace(/^0x/i, '');
  if (clean.length !== 64 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error('Private key must be exactly 64 hex characters');
  }

  await ensureBuffer();
  const { Account } = await import('warthog-js');
  return accountToWalletData(Account.fromPrivateKeyHex(clean));
}