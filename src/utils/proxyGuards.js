import { isFakeMineAllowed } from './nodeAccess.js';

export const isFakeMineNodePath = (nodePath) =>
  /^debug\/fakemine(?:\/|$)/i.test(String(nodePath || '').replace(/^\//, ''));

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