// src/workers/warthogSigner.worker.js
// Isolated Web Worker that holds the private key and performs all signing.
// The main thread never keeps the raw private key after handoff.
//
// Message protocol (request -> response):
//   INIT            { privateKey: '64-hex' }                     -> { type: 'INIT_OK' } | ERROR
//   SIGN_HASH       { hashHex: '64-hex' }                        -> { type: 'SIGN_HASH_OK', r, s, v, signature65 } | ERROR
//   SIGN_MESSAGE    { message: string }                          -> { type: 'SIGN_MESSAGE_OK', signature } | ERROR
//   LOCK            {}                                           -> { type: 'LOCK_OK' }
//   STATUS          {}                                           -> { type: 'STATUS_OK', hasKey: boolean }
//
// The worker only ever sees the 64-char hex private key (no 0x prefix), matching the rest of the app.

import { ethers } from 'ethers';

let privateKey = null; // 64 hex chars, no 0x. Lives only in this worker's memory.

function clearKey() {
  // Best-effort overwrite (strings are immutable in JS, but we can at least drop the reference).
  privateKey = null;
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  const { type, id, ...payload } = msg;

  const respond = (data) => self.postMessage({ id, ...data });
  const fail = (error) => respond({ type: 'ERROR', error: String(error?.message || error) });

  try {
    if (type === 'INIT') {
      const pk = payload.privateKey;
      if (typeof pk !== 'string' || pk.length !== 64 || !/^[0-9a-fA-F]+$/.test(pk)) {
        throw new Error('INIT requires a 64-character hex private key (no 0x)');
      }
      privateKey = pk;
      respond({ type: 'INIT_OK' });
      return;
    }

    if (!privateKey) {
      fail('No private key loaded in signer (locked or never initialized)');
      return;
    }

    if (type === 'SIGN_HASH') {
      const { hashHex } = payload;
      if (typeof hashHex !== 'string' || hashHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hashHex)) {
        throw new Error('SIGN_HASH requires 64-char hex hash (no 0x)');
      }

      const signer = new ethers.Wallet('0x' + privateKey);
      const signature = await signer.signingKey.sign(ethers.getBytes('0x' + hashHex));

      const r = signature.r.slice(2).padStart(64, '0');
      const s = signature.s.slice(2).padStart(64, '0');
      const v = (signature.v - 27).toString(16).padStart(2, '0');
      const signature65 = r + s + v;

      respond({ type: 'SIGN_HASH_OK', r, s, v, signature65 });
      return;
    }

    if (type === 'SIGN_MESSAGE') {
      const { message } = payload;
      if (typeof message !== 'string') {
        throw new Error('SIGN_MESSAGE requires a string message');
      }

      const signer = new ethers.Wallet('0x' + privateKey);
      const signature = await signer.signMessage(message);

      respond({ type: 'SIGN_MESSAGE_OK', signature });
      return;
    }

    if (type === 'LOCK') {
      clearKey();
      respond({ type: 'LOCK_OK' });
      return;
    }

    if (type === 'STATUS') {
      respond({ type: 'STATUS_OK', hasKey: !!privateKey });
      return;
    }

    if (type === 'GET_PRIVATE_KEY') {
      if (!privateKey) {
        fail('No private key loaded');
        return;
      }
      respond({ type: 'GET_PRIVATE_KEY_OK', privateKey });
      return;
    }

    fail(`Unknown message type: ${type}`);
  } catch (err) {
    fail(err);
  }
};

// Optional: in case the worker is terminated, clear on unload (best effort).
self.addEventListener?.('unload', () => {
  clearKey();
});
