/** True only for nodes running locally (safe for debug/fakemine). */
export const isFakeMineAllowed = (node) => {
  if (!node) return false;
  try {
    const host = new URL(node).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    const n = node.toLowerCase();
    return n.includes('localhost') || n.includes('127.0.0.1');
  }
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