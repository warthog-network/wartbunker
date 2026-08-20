import { getSigningStatus, signWarthogBytesInWorker } from './signingBridge.js';

const METADATA_ORIGINS = new Set([
  'https://warthog-defitestnet.duckdns.org:4445',
]);

const TYPE_HELLO = 'wart-metadata-hello';
const TYPE_ACCOUNT = 'wart-metadata-account';
const TYPE_SIGN = 'wart-metadata-sign';
const TYPE_SIGNED = 'wart-metadata-signed';
const TYPE_ERROR = 'wart-metadata-error';

function reply(event, payload) {
  try {
    event.source?.postMessage(payload, event.origin);
  } catch {
    // popup may have closed
  }
}

async function handleHello(event) {
  try {
    const status = await getSigningStatus();
    if (!status?.unlocked || !status.address) {
      reply(event, {
        type: TYPE_ACCOUNT,
        ok: false,
        error: 'Unlock your wallet in WartBunker first',
      });
      return;
    }
    reply(event, {
      type: TYPE_ACCOUNT,
      ok: true,
      address: status.address,
    });
  } catch (err) {
    reply(event, {
      type: TYPE_ACCOUNT,
      ok: false,
      error: err?.message || 'WartBunker wallet is not available',
    });
  }
}

async function handleSign(event) {
  const id = event.data?.id;
  const message = event.data?.message;
  if (!message) {
    reply(event, { type: TYPE_ERROR, id, error: 'missing message to sign' });
    return;
  }
  try {
    const signed = await signWarthogBytesInWorker(message);
    reply(event, {
      type: TYPE_SIGNED,
      id,
      ok: true,
      signature: signed.signature,
      address: signed.address,
    });
  } catch (err) {
    reply(event, {
      type: TYPE_ERROR,
      id,
      error: err?.message || 'signing failed',
    });
  }
}

function onMessage(event) {
  if (!METADATA_ORIGINS.has(event.origin)) return;
  if (!event.source) return;
  const type = event.data?.type;
  if (type === TYPE_HELLO) {
    void handleHello(event);
  } else if (type === TYPE_SIGN) {
    void handleSign(event);
  }
}

export function startMetadataSessionBridge() {
  if (typeof window === 'undefined') return () => {};
  if (window.__wartMetadataBridgeStarted) return () => {};
  window.addEventListener('message', onMessage);
  window.__wartMetadataBridgeStarted = true;
  return () => {
    window.removeEventListener('message', onMessage);
    window.__wartMetadataBridgeStarted = false;
  };
}

export function openMetadataForm(url) {
  if (!url) return;
  const child = window.open(url, 'warthog-metadata');
  if (!child) {
    window.location.assign(url);
  }
}
