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

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {onCopy ? (
              <button
                type="button"
                onClick={() => onCopy(address)}
                className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1"
              >
                Copy address
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}