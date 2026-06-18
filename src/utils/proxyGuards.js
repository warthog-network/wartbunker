import { isFakeMineAllowed, isLocalNode } from './nodeAccess.js';

export const isFakeMineNodePath = (nodePath) =>
  /^debug\/fakemine(?:\/|$)/i.test(String(nodePath || '').replace(/^\//, ''));

/** Block local/LAN targets — the server proxy cannot reach the user's machine. */
export const rejectLocalNodeInProxy = (nodeBase) => {
  if (!isLocalNode(nodeBase)) return null;

  return {
    status: 400,
    body: JSON.stringify({
      code: 1,
      error:
        'Local and LAN nodes must be reached directly from your browser, not through the server proxy. '
        + 'Reconnect using a localhost or private-network node URL — the wallet will connect automatically.',
    }),
  };
};

export const rejectFakeMineIfRemote = (nodePath, nodeBase) => {
  if (!isFakeMineNodePath(nodePath)) return null;
  if (isFakeMineAllowed(nodeBase)) return null;

  return {
    status: 403,
    body: JSON.stringify({
      code: 1,
      error: 'Fake mining is disabled for remote nodes. Use a local node (localhost) for dev mining.',
    }),
  };
};