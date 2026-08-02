import React, { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { copyTextToClipboard } from '../utils/copyText.js';

export default function AddressQrModal({ open, address, onClose, onCopy }) {
  const [copyState, setCopyState] = useState('idle'); // idle | copied | error

  useEffect(() => {
    if (!open) setCopyState('idle');
  }, [open]);

  useEffect(() => {
    if (copyState !== 'copied') return undefined;
    const t = setTimeout(() => setCopyState('idle'), 2000);
    return () => clearTimeout(t);
  }, [copyState]);

  if (!open || !address) return null;

  const addressText = String(address);

  const handleCopy = async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    const ok = await copyTextToClipboard(addressText);
    if (ok) {
      setCopyState('copied');
      // Notify parent for toast only — do not re-copy (user-gesture / clipboard can fail on a 2nd write)
      try {
        onCopy?.(addressText);
      } catch {
        // ignore
      }
    } else {
      setCopyState('error');
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="relative w-full max-w-sm rounded-3xl bg-zinc-900 border border-zinc-700 shadow-2xl overflow-hidden animate-[toastSlideIn_0.2s_cubic-bezier(0.32,0.72,0,1)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="receive-qr-title"
      >
        <div className="px-6 pt-6 pb-5 text-center">
          <div id="receive-qr-title" className="text-lg font-semibold text-white tracking-[-0.2px]">
            Receive WART
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            Scan this QR code or copy your wallet address
          </p>

          <div className="mt-5 inline-block rounded-2xl bg-white p-4 shadow-lg">
            <QRCode value={addressText} size={200} level="M" />
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="mt-4 w-full font-mono text-xs text-zinc-300 break-all select-all leading-relaxed hover:text-[#FDB913] transition-colors cursor-pointer text-left"
            title="Click to copy address"
          >
            {addressText}
          </button>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className={`compact-btn !mx-0 !my-0 !px-3 !py-1.5 font-semibold ${
                copyState === 'copied'
                  ? '!bg-emerald-900/50 !border-emerald-700 !text-emerald-300'
                  : copyState === 'error'
                    ? '!bg-red-950/50 !border-red-800 !text-red-300'
                    : 'hover:!text-[#E79300]'
              }`}
            >
              {copyState === 'copied'
                ? 'Copied!'
                : copyState === 'error'
                  ? 'Copy failed — try long-press'
                  : 'Copy address'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1.5"
            >
              Close
            </button>
          </div>

          {copyState === 'copied' && (
            <p className="mt-3 text-[11px] text-emerald-400/90" role="status">
              Address copied to clipboard
            </p>
          )}
          {copyState === 'error' && (
            <p className="mt-3 text-[11px] text-red-400/90" role="status">
              Could not access clipboard. Select the address above and copy manually.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
