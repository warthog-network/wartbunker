const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/** Parse a node URL hostname, or null when invalid. */
export const parseNodeHostname = (node) => {
  if (!node) return null;
  try {
    return new URL(node).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/** True for nodes reachable from the user's browser (loopback + private LAN). */
export const isLocalNode = (node) => {
  const host = parseNodeHostname(node);
  if (!host) {
    const n = String(node).toLowerCase();
    return n.includes('localhost') || n.includes('127.0.0.1');
  }
  if (LOCAL_HOSTS.has(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host.endsWith('.local')) return true;
  return false;
};

/** True only for nodes running locally (safe for debug/fakemine). */
export const isFakeMineAllowed = (node) => {
  const host = parseNodeHostname(node);
  if (!host) {
    const n = String(node).toLowerCase();
    return n.includes('localhost') || n.includes('127.0.0.1');
  }
  return host === 'localhost' || host === '127.0.0.1';
};

/** Clear legacy auto-mining preferences from older app versions. */
export const clearLegacyAutoMinePrefs = () => {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith('warthogAutoMine_')) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // ignore storage errors
  }
};