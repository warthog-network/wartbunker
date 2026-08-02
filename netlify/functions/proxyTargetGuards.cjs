/**
 * CJS mirror of src/utils/proxyGuards.js target checks for the Netlify proxy.
 * Keep behavior aligned when updating either file.
 */

const isFakeMineNodePath = (nodePath) =>
  /^debug\/fakemine(?:\/|$)/i.test(String(nodePath || '').replace(/^\//, ''));

const isFakeMineAllowed = (node) => {
  if (!node) return false;
  try {
    const host = new URL(node).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    const n = String(node).toLowerCase();
    return n.includes('localhost') || n.includes('127.0.0.1');
  }
};

const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

function parseIpv4(host) {
  const m = String(host || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return parts;
}

function isBlockedIpv4(parts) {
  if (!parts || parts.length !== 4) return true;
  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIpv6(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true;
  if (h.startsWith('fe80:')) return true;
  const mapped = h.match(/:ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return isBlockedIpv4(parseIpv4(mapped[1]));
  return false;
}

function isBlockedHostnameOrIp(host) {
  if (!host) return true;
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  const v4 = parseIpv4(h);
  if (v4) return isBlockedIpv4(v4);
  if (h.includes(':')) return isBlockedIpv6(h);
  return false;
}

function sanitizeNodePath(nodePath) {
  const raw = String(nodePath ?? '').trim();
  if (!raw) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  if (raw.includes('\\')) return null;
  const noLead = raw.replace(/^\/+/, '');
  if (!noLead || noLead.includes('..')) return null;
  if (!/^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(noLead)) return null;
  return noLead;
}

function validateProxyNodeBase(nodeBase) {
  const raw = String(nodeBase || '').trim();
  if (!raw) {
    return { ok: false, status: 400, error: 'Missing nodeBase' };
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, status: 400, error: 'Invalid nodeBase URL' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, status: 400, error: 'Only http and https node URLs are allowed through the proxy' };
  }

  if (url.username || url.password) {
    return { ok: false, status: 400, error: 'nodeBase must not include credentials' };
  }

  const host = url.hostname.toLowerCase();
  if (!host || isBlockedHostnameOrIp(host)) {
    return {
      ok: false,
      status: 400,
      error:
        'Private, loopback, or link-local nodes cannot be reached through the server proxy. '
        + 'Use a public HTTP/HTTPS node URL.',
    };
  }

  return { ok: true, origin: `${url.protocol}//${url.host}` };
}

function buildSafeProxyTarget(nodeBase, nodePath) {
  const base = validateProxyNodeBase(nodeBase);
  if (!base.ok) return base;

  const path = sanitizeNodePath(nodePath);
  if (!path) {
    return { ok: false, status: 400, error: 'Invalid or missing nodePath' };
  }

  if (isFakeMineNodePath(path) && !isFakeMineAllowed(base.origin)) {
    return {
      ok: false,
      status: 403,
      error: 'Fake mining is disabled for remote nodes. Use a local node (localhost) for dev mining.',
    };
  }

  return { ok: true, targetUrl: `${base.origin}/${path}` };
}

module.exports = {
  buildSafeProxyTarget,
  validateProxyNodeBase,
  sanitizeNodePath,
  isFakeMineNodePath,
};
