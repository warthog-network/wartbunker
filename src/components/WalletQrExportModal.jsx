import React, { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { encryptWallet } from '../utils/warthogWalletUtils';
import { exportWalletFromWorker } from '../utils/signingBridge.js';
import { encodeWalletQrPayload, getWalletQrCapacityError } from '../utils/walletQr.js';

export default function WalletQrExportModal({
  open,
  wallet,
  isSigningUnlocked,
  onClose,
}) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [qrPayload, setQrPayload] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setConfirmPassword('');
      setQrPayload(null);
      setError(null);
      setLoading(false);
    }
  }, [open]);

  if (!open) return null;

  const handleGenerate = async () => {
    setError(null);
    if (!password || password.length < 4) {
      setError('Choose a password with at least 4 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!wallet) {
      setError('No active wallet');
      return;
    }
    if (!isSigningUnlocked && !wallet.privateKey) {
      setError('Unlock your wallet first — the private key is needed to export');
      return;
    }

    setLoading(true);
    try {
      let walletData = wallet;
      if (!walletData.privateKey) {
        walletData = await exportWalletFromWorker();
      }

      const encrypted = encryptWallet(walletData, password);
      const capacityErr = getWalletQrCapacityError(encrypted);
      if (capacityErr) {
        setError(capacityErr);
        return;
      }

      setQrPayload(encodeWalletQrPayload(encrypted));
    } catch (err) {
      setError(err?.message || 'Failed to create export QR');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-md rounded-3xl bg-zinc-900 border border-zinc-700 shadow-2xl overflow-hidden animate-[toastSlideIn_0.2s_cubic-bezier(0.32,0.72,0,1)] max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4">
          <div className="text-lg font-semibold text-white tracking-[-0.2px]">Transfer to Mobile</div>
          <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
            Create a password-encrypted QR code for the mobile Warthog wallet. Scan it on your phone,
            then enter the same password to import.
          </p>

          {!qrPayload ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-amber-700/40 bg-amber-950/30 px-3 py-2.5 text-xs text-amber-200/90 leading-relaxed">
                Only generate this on a device you trust. Anyone who scans the QR and knows the
                password can access your wallet.
              </div>

              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Export password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input font-mono text-sm w-full"
                  autoComplete="new-password"
                  placeholder="Password for mobile import"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Confirm password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input font-mono text-sm w-full"
                  autoComplete="new-password"
                  placeholder="Repeat password"
                />
              </div>

              {error ? (
                <p className="text-sm text-red-400">{error}</p>
              ) : null}

              <button
                type="button"
                onClick={handleGenerate}
                disabled={loading}
                className="wallet-action-btn w-full !m-0 font-semibold disabled:opacity-60"
              >
                {loading ? 'Encrypting…' : 'Generate QR Code'}
              </button>
            </div>
          ) : (
            <div className="mt-4 text-center">
              <div className="inline-block rounded-2xl bg-white p-4 shadow-lg">
                <QRCode value={qrPayload} size={220} level="M" />
              </div>
              <p className="mt-4 text-xs text-zinc-400 leading-relaxed">
                Open the mobile app → Login → Scan Wallet QR → enter your export password.
              </p>
              <p className="mt-2 text-[10px] text-zinc-500">
                QR expires when you close this dialog — generate again anytime with the same password.
              </p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-zinc-800 bg-zinc-900 flex gap-3">
          {qrPayload ? (
            <button
              type="button"
              onClick={() => {
                setQrPayload(null);
                setPassword('');
                setConfirmPassword('');
              }}
              className="flex-1 py-3 text-sm font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-2xl border border-zinc-700 transition-colors"
            >
              New QR
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 text-sm font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-2xl border border-zinc-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}