import { useEffect, useState } from 'react';

/** Official GitHub Pages export of warthog-network/public-data. */
export const PUBLIC_DATA_API = 'https://data.warthog.network';
export const ZERO_ASSET_HASH = '0'.repeat(64);

/**
 * ICE (IceCube) landed in public-data PR #9 but is not on master /
 * data.warthog.network until a maintainer merges. Keep a raw-branch
 * fallback so bunker can show it immediately.
 */
const PENDING_BY_HASH = {
  '0378b2df12a28c749facfcc7caa55edec0672b6c908c3a7ec152caf5aa2d4679': {
    name: 'IceCube',
    ticker: 'ICE',
    infoUrl:
      'https://raw.githubusercontent.com/warthog-network/public-data/asset-metadata/0378b2df12a2/data/assets/0378b2df12a28c749facfcc7caa55edec0672b6c908c3a7ec152caf5aa2d4679/info.json',
    logoUrl:
      'https://raw.githubusercontent.com/warthog-network/public-data/asset-metadata/0378b2df12a2/data/assets/0378b2df12a28c749facfcc7caa55edec0672b6c908c3a7ec152caf5aa2d4679/logo.png',
  },
};

const memory = new Map();
let catalogPromise = null;

export function normalizeAssetMetaHash(hash) {
  const clean = String(hash || '').trim().toLowerCase().replace(/^0x/i, '');
  return /^[0-9a-f]{64}$/.test(clean) ? clean : '';
}

const LOCAL_LOGOS = {
  [ZERO_ASSET_HASH]: [`/asset-meta/${ZERO_ASSET_HASH}/image.png`],
  '0378b2df12a28c749facfcc7caa55edec0672b6c908c3a7ec152caf5aa2d4679': [
    '/asset-meta/0378b2df12a28c749facfcc7caa55edec0672b6c908c3a7ec152caf5aa2d4679/logo.png',
  ],
};

export function assetLogoCandidates(hash) {
  const h = normalizeAssetMetaHash(hash);
  if (!h) return [];
  const pending = PENDING_BY_HASH[h];
  return [
    ...(LOCAL_LOGOS[h] || []),
    `${PUBLIC_DATA_API}/assets/${h}/logo.png`,
    `${PUBLIC_DATA_API}/assets/${h}/image.png`,
    `https://raw.githubusercontent.com/warthog-network/public-data/master/data/assets/${h}/logo.png`,
    `https://raw.githubusercontent.com/warthog-network/public-data/master/data/assets/${h}/image.png`,
    pending?.logoUrl,
  ].filter(Boolean);
}

const LOCAL_INFO = {
  [ZERO_ASSET_HASH]: `/asset-meta/${ZERO_ASSET_HASH}/info.json`,
  '0378b2df12a28c749facfcc7caa55edec0672b6c908c3a7ec152caf5aa2d4679':
    '/asset-meta/0378b2df12a28c749facfcc7caa55edec0672b6c908c3a7ec152caf5aa2d4679/info.json',
};

function infoCandidates(hash) {
  const h = normalizeAssetMetaHash(hash);
  if (!h) return [];
  const pending = PENDING_BY_HASH[h];
  return [
    LOCAL_INFO[h],
    `${PUBLIC_DATA_API}/assets/${h}/info.json`,
    `https://raw.githubusercontent.com/warthog-network/public-data/master/data/assets/${h}/info.json`,
    pending?.infoUrl,
  ].filter(Boolean);
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
    for (const url of infoCandidates(h)) {
      const raw = await fetchJson(url).catch(() => null);
      const info = normalizeInfo(raw, h);
      if (info) return info;
    }
    const seed = PENDING_BY_HASH[h];
    if (seed) {
      return normalizeInfo(
        {
          hash: h,
          name: seed.name,
          ticker: seed.ticker,
        },
        h,
      );
    }
    return null;
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
      const listed = await fetchJson(`${PUBLIC_DATA_API}/assets.json`);
      const byHash = new Map();
      if (Array.isArray(listed)) {
        for (const row of listed) {
          const info = normalizeInfo(row, normalizeAssetMetaHash(row?.hash));
          if (info) byHash.set(info.hash, info);
        }
      }
      for (const [hash, seed] of Object.entries(PENDING_BY_HASH)) {
        if (!byHash.has(hash)) {
          byHash.set(
            hash,
            normalizeInfo({ hash, name: seed.name, ticker: seed.ticker }, hash),
          );
        }
      }
      return [...byHash.values()];
    })().catch(() => {
      catalogPromise = null;
      return Object.entries(PENDING_BY_HASH).map(([hash, seed]) =>
        normalizeInfo({ hash, name: seed.name, ticker: seed.ticker }, hash),
      );
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
