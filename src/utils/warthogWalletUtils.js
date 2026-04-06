// utils/warthogWalletUtils.js
import { ethers } from 'ethers';
import CryptoJS from 'crypto-js';

export const generateWallet = (wordCount, pathType) => {
  const strength = wordCount === '12' ? 128 : 256;
  const entropy = ethers.randomBytes(strength / 8);
  const mnemonic = ethers.Mnemonic.fromEntropy(entropy).phrase;

  const path = pathType === 'hardened' 
    ? "m/44'/2070'/0'/0/0" 
    : "m/44'/2070'/0/0/0";

  const hdWallet = ethers.HDNodeWallet.fromPhrase(mnemonic, '', path);
  const publicKey = hdWallet.publicKey.slice(2);
  const sha = ethers.sha256('0x' + publicKey).slice(2);
  const ripemd = ethers.ripemd160('0x' + sha).slice(2);
  const checksum = ethers.sha256('0x' + ripemd).slice(2, 10);
  const address = ripemd + checksum;

  return {
    mnemonic,
    wordCount: Number(wordCount),
    pathType,
    privateKey: hdWallet.privateKey.slice(2),
    publicKey,
    address
  };
};

export const deriveWallet = (mnemonicPhrase, wordCount, pathType) => {
  const path = pathType === 'hardened' 
    ? "m/44'/2070'/0'/0/0" 
    : "m/44'/2070'/0/0/0";

  const hdWallet = ethers.HDNodeWallet.fromPhrase(mnemonicPhrase, '', path);
  const publicKey = hdWallet.publicKey.slice(2);
  const sha = ethers.sha256('0x' + publicKey).slice(2);
  const ripemd = ethers.ripemd160('0x' + sha).slice(2);
  const checksum = ethers.sha256('0x' + ripemd).slice(2, 10);
  const address = ripemd + checksum;

  return {
    mnemonic: mnemonicPhrase,
    wordCount: Number(wordCount),
    pathType,
    privateKey: hdWallet.privateKey.slice(2),
    publicKey,
    address
  };
};

export const importFromPrivateKey = (privKey) => {
  if (privKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(privKey)) {
    throw new Error('Private key must be exactly 64 hex characters');
  }
  const wallet = new ethers.Wallet('0x' + privKey);
  const publicKey = wallet.signingKey.compressedPublicKey.slice(2);
  const sha = ethers.sha256('0x' + publicKey).slice(2);
  const ripemd = ethers.ripemd160('0x' + sha).slice(2);
  const checksum = ethers.sha256('0x' + ripemd).slice(2, 10);
  const address = ripemd + checksum;

  return { privateKey: privKey, publicKey, address };
};

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
