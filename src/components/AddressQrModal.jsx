import React from 'react';
import QRCode from 'react-qr-code';

export default function AddressQrModal({ open, address, onClose, onCopy }) {
  if (!open || !address) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-sm rounded-3xl bg-zinc-900 border border-zinc-700 shadow-2xl overflow-hidden animate-[toastSlideIn_0.2s_cubic-bezier(0.32,0.72,0,1)]">
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="text-lg font-semibold text-white tracking-[-0.2px]">Receive WART</div>
          <p className="mt-2 text-sm text-zinc-400">
            Scan this QR code to copy your wallet address
          </p>

          <div className="mt-5 inline-block rounded-2xl bg-white p-4 shadow-lg">
            <QRCode value={address} size={200} level="M" />
          </div>

          <p className="mt-4 font-mono text-xs text-zinc-300 break-all select-all leading-relaxed">
            {address}
          </p>

          {onCopy ? (
            <button
              type="button"
              onClick={() => onCopy(address)}
              className="mt-3 text-xs font-medium text-[#E79300] hover:text-[#FDB913] transition-colors"
            >
              Copy address
            </button>
          ) : null}
        </div>

        <div className="p-4 border-t border-zinc-800 bg-zinc-900">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 text-sm font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-950 rounded-2xl border border-zinc-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}