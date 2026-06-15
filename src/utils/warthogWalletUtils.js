import CryptoJS from 'crypto-js';
import { ethers } from 'ethers';

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

/** Derive a Warthog address from a public key hex (compressed or uncompressed). */
export const deriveWarthogAddress = (publicKeyHex) => {
  if (!publicKeyHex) return null;
  let pk = publicKeyHex.startsWith('0x') ? publicKeyHex.slice(2) : publicKeyHex;

  if (pk.length === 130 && pk.startsWith('04')) {
    const x = pk.slice(2, 66);
    const y = pk.slice(66);
    const yLast = parseInt(y.slice(-2), 16);
    const prefix = (yLast % 2 === 0) ? '02' : '03';
    pk = prefix + x;
  }

  const sha = ethers.sha256(`0x${pk}`).slice(2);
  const ripemd = ethers.ripemd160(`0x${sha}`).slice(2);
  const checksum = ethers.sha256(`0x${ripemd}`).slice(2, 10);
  return ripemd + checksum;
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