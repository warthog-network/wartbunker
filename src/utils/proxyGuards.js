import { isFakeMineAllowed, isLoopbackNode } from './nodeAccess.js';

export const isFakeMineNodePath = (nodePath) =>
  /^debug\/fakemine(?:\/|$)/i.test(String(nodePath || '').replace(/^\//, ''));

const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

/** Parse IPv4 from a hostname string; null if not a dotted IPv4. */
function parseIpv4(host) {
  const m = String(host || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return parts;
}

/** True for loopback / private / link-local / unspecified IPv4. */
export function isBlockedIpv4(parts) {
  if (!parts || parts.length !== 4) return true;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (optional harden)
  if (a >= 224) return true; // multicast / reserved
  return false;
}

/** True for blocked IPv6 literals (loopback, ULA, link-local, v4-mapped private). */
export function isBlockedIpv6(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA
  if (h.startsWith('fe80:')) return true; // link-local
  // IPv4-mapped :ffff:x.x.x.x
  const mapped = h.match(/:ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) {
    const parts = parseIpv4(mapped[1]);
    return isBlockedIpv4(parts);
  }
  return false;
}

export function isBlockedHostnameOrIp(host) {
  if (!host) return true;
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;

  const v4 = parseIpv4(h);
  if (v4) return isBlockedIpv4(v4);
  if (h.includes(':')) return isBlockedIpv6(h);
  return false;
}

/**
 * Sanitize nodePath so it cannot escape into another URL or path traversal.
 * @returns {string|null} cleaned path without leading slash, or null if invalid
 */
export function sanitizeNodePath(nodePath) {
  const raw = String(nodePath ?? '').trim();
  if (!raw) return null;
  // Disallow absolute URLs smuggled as path
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  if (raw.includes('\\')) return null;
  const noLead = raw.replace(/^\/+/, '');
  if (!noLead || noLead.includes('..')) return null;
  // Keep paths like account/x/balance and debug/fakemine
  if (!/^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(noLead)) return null;
  return noLead;
}

/**
 * Validate that nodeBase is a safe public HTTP(S) origin for the *server* proxy.
 * Does not block public testnet IPs. Blocks loopback, RFC1918, metadata, non-http(s).
 *
 * @returns {{ ok: true, origin: string } | { ok: false, status: number, body: string }}
 */
export function validateProxyNodeBase(nodeBase) {
  const raw = String(nodeBase || '').trim();
  if (!raw) {
    return {
      ok: false,
      status: 400,
      body: JSON.stringify({ code: 1, error: 'Missing nodeBase' }),
    };
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return {
      ok: false,
      status: 400,
      body: JSON.stringify({ code: 1, error: 'Invalid nodeBase URL' }),
    };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      status: 400,
      body: JSON.stringify({
        code: 1,
        error: 'Only http and https node URLs are allowed through the proxy',
      }),
    };
  }

  // userinfo can be abused in some SSRF / log injection cases
  if (url.username || url.password) {
    return {
      ok: false,
      status: 400,
      body: JSON.stringify({ code: 1, error: 'nodeBase must not include credentials' }),
    };
  }

  const host = url.hostname.toLowerCase();
  if (!host) {
    return {
      ok: false,
      status: 400,
      body: JSON.stringify({ code: 1, error: 'Invalid nodeBase host' }),
    };
  }

  if (isLoopbackNode(raw) || isBlockedHostnameOrIp(host)) {
    return {
      ok: false,
      status: 400,
      body: JSON.stringify({
        code: 1,
        error:
          'Private, loopback, or link-local nodes cannot be reached through the server proxy. '
          + 'Use a public HTTP/HTTPS node URL, or connect to localhost only from a local wallet build.',
      }),
    };
  }

  // Normalize origin (no path/query on base — clients append nodePath)
  const origin = `${url.protocol}//${url.host}`;
  return { ok: true, origin };
}

/** Block loopback targets — the server proxy would hit its own machine, not the user's. */
export const rejectLocalNodeInProxy = (nodeBase) => {
  const result = validateProxyNodeBase(nodeBase);
  if (result.ok) return null;
  return { status: result.status, body: result.body };
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

/**
 * Full proxy target check: base + path.
 * @returns {{ ok: true, targetUrl: string } | { ok: false, status: number, body: string }}
 */
export function buildSafeProxyTarget(nodeBase, nodePath) {
  const base = validateProxyNodeBase(nodeBase);
  if (!base.ok) return base;

  const path = sanitizeNodePath(nodePath);
  if (!path) {
    return {
      ok: false,
      status: 400,
      body: JSON.stringify({ code: 1, error: 'Invalid or missing nodePath' }),
    };
  }

  const fakeMine = rejectFakeMineIfRemote(path, base.origin);
  if (fakeMine) {
    return { ok: false, status: fakeMine.status, body: fakeMine.body };
  }

  return {
    ok: true,
    targetUrl: `${base.origin}/${path}`,
  };
}
