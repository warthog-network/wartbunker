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

/** True for loopback-only nodes (localhost / 127.0.0.1). */
export const isLoopbackNode = (node) => {
  const host = parseNodeHostname(node);
  if (!host) {
    const n = String(node).toLowerCase();
    return n.includes('localhost') || n.includes('127.0.0.1');
  }
  return LOCAL_HOSTS.has(host);
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

/**
 * Whether browser requests should go through /api/proxy (matches warthog.network website).
 *
 * - Public nodes: always proxy so HTTPS sites can reach plain-HTTP peers.
 * - Loopback / private LAN: connect directly (server proxy must not hit internal nets).
 * - Exception: loopback over plain http:// while the page is https — browser mixed-content
 *   blocks direct access; proxy also cannot reach the user's machine, so still "use proxy"
 *   only for error path consistency (request will fail closed with a clear guard).
 */
export const shouldUseNodeProxy = (node) => {
  // Private / loopback / .local → prefer direct browser connection
  if (isLocalNode(node)) {
    if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
      const n = String(node).trim().toLowerCase();
      // https page + http://localhost cannot work via proxy either; keep prior signal
      if (n.startsWith('http://') && isLoopbackNode(node)) return true;
    }
    return false;
  }
  return true;
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