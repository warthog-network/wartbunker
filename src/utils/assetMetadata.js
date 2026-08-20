import { useEffect, useState } from 'react';

/** Off-chain catalog on this VPS (Postgres). Replaces GitHub public-data. */
export const METADATA_BASE = 'https://warthog-defitestnet.duckdns.org:4445';
/** @deprecated kept so old imports keep compiling */
export const PUBLIC_DATA_API = METADATA_BASE;
export const ZERO_ASSET_HASH = '0'.repeat(64);

const memory = new Map();
let catalogPromise = null;

export function normalizeAssetMetaHash(hash) {
  const clean = String(hash || '').trim().toLowerCase().replace(/^0x/i, '');
  return /^[0-9a-f]{64}$/.test(clean) ? clean : '';
}

export function assetLogoCandidates(hash) {
  const h = normalizeAssetMetaHash(hash);
  if (!h) return [];
  return [`${METADATA_BASE}/assets/${h}/logo.png`, `${METADATA_BASE}/assets/${h}/image.png`];
}

function infoUrl(hash) {
  return `${METADATA_BASE}/assets/${hash}/info.json`;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const type = res.headers.get('content-type') || '';
  if (type.includes('text/html')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeInfo(raw, hash) {
  if (!raw || typeof raw !== 'object') return null;
  const h = normalizeAssetMetaHash(raw.hash) || hash;
  const name = String(raw.name || '').trim();
  const ticker = String(raw.ticker || '').trim();
  if (!h || (!name && !ticker)) return null;
  return {
    hash: h,
    name: name || ticker,
    ticker: ticker || name,
    description: String(raw.description || '').trim(),
    website: String(raw.website || '').trim(),
    telegram: String(raw.telegram || '').trim(),
    discord: String(raw.discord || '').trim(),
    twitter: String(raw.twitter || '').trim(),
    logoUrl: assetLogoCandidates(h)[0] || '',
    logoCandidates: assetLogoCandidates(h),
  };
}

export async function fetchAssetMetadata(hash) {
  const h = normalizeAssetMetaHash(hash);
  if (!h) return null;
  if (memory.has(h)) return memory.get(h);

  const pending = (async () => {
    const raw = await fetchJson(infoUrl(h)).catch(() => null);
    return normalizeInfo(raw, h);
  })();

  memory.set(h, pending);
  const resolved = await pending;
  memory.set(h, resolved);
  return resolved;
}

export function peekAssetMetadata(hash) {
  const h = normalizeAssetMetaHash(hash);
  if (!h || !memory.has(h)) return null;
  const v = memory.get(h);
  return v && typeof v.then === 'function' ? null : v;
}

export async function loadAssetCatalog() {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const listed = await fetchJson(`${METADATA_BASE}/assets.json`);
      const byHash = new Map();
      if (Array.isArray(listed)) {
        for (const row of listed) {
          const info = normalizeInfo(row, normalizeAssetMetaHash(row?.hash));
          if (info) byHash.set(info.hash, info);
        }
      }
      return [...byHash.values()];
    })().catch(() => {
      catalogPromise = null;
      return [];
    });
  }
  return catalogPromise;
}

export async function searchAssetCatalog(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const catalog = await loadAssetCatalog();
  return catalog.filter((row) => {
    const name = (row.name || '').toLowerCase();
    const ticker = (row.ticker || '').toLowerCase();
    const hash = row.hash || '';
    return name.includes(q) || ticker.includes(q) || hash.startsWith(q);
  });
}

export function assetDisplayName(onChainName, meta) {
  return meta?.name || onChainName || 'Asset';
}

export function assetDisplayTicker(onChainName, meta) {
  return meta?.ticker || onChainName || '';
}

export function useAssetMetadata(hash) {
  const normalized = normalizeAssetMetaHash(hash);
  const [meta, setMeta] = useState(() => peekAssetMetadata(normalized));

  useEffect(() => {
    let live = true;
    if (!normalized) {
      setMeta(null);
      return undefined;
    }
    const cached = peekAssetMetadata(normalized);
    if (cached) setMeta(cached);
    fetchAssetMetadata(normalized).then((next) => {
      if (live) setMeta(next);
    });
    return () => {
      live = false;
    };
  }, [normalized]);

  return meta;
}
