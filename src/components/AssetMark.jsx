import React, { useEffect, useMemo, useState } from 'react';
import {
  assetDisplayName,
  assetDisplayTicker,
  assetLogoCandidates,
  useAssetMetadata,
} from '../utils/assetMetadata.js';

const SIZE = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-sm',
  md: 'w-9 h-9 text-sm',
  lg: 'w-11 h-11 text-2xl',
};

export default function AssetMark({
  hash,
  name,
  size = 'md',
  className = '',
  rounded = 'rounded-xl',
}) {
  const meta = useAssetMetadata(hash);
  const urls = useMemo(() => {
    const list = [];
    if (meta?.logoUrl) list.push(meta.logoUrl);
    list.push(...(meta?.logoCandidates || assetLogoCandidates(hash)));
    return [...new Set(list)];
  }, [hash, meta]);
  const [idx, setIdx] = useState(0);
  const src = urls[idx];
  const letter = (assetDisplayTicker(name, meta) || assetDisplayName(name, meta) || '?')
    .charAt(0)
    .toUpperCase();

  useEffect(() => {
    setIdx(0);
  }, [hash]);

  return (
    <div
      className={`${SIZE[size] || SIZE.md} ${rounded} overflow-hidden flex-shrink-0 bg-gradient-to-br from-blue-500 via-cyan-500 to-teal-500 flex items-center justify-center text-white font-bold ring-1 ring-white/20 ${className}`}
      title={assetDisplayName(name, meta)}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setIdx((i) => i + 1)}
        />
      ) : (
        letter || '?'
      )}
    </div>
  );
}

export function AssetTitle({ hash, name, className = '' }) {
  const meta = useAssetMetadata(hash);
  const display = assetDisplayName(name, meta);
  const ticker = assetDisplayTicker(name, meta);
  const showTicker = ticker && ticker.toLowerCase() !== display.toLowerCase();
  return (
    <span className={className}>
      {display}
      {showTicker ? (
        <span className="text-zinc-500 font-medium"> · {ticker}</span>
      ) : null}
    </span>
  );
}
