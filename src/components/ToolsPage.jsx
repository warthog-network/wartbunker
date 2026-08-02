import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import { validateWarthogAddressInput } from '../utils/warthogFormat.js';
import { DEFAULT_NODE_URL, isDefiNode, resolveSavedNodeUrl } from '../utils/presetNodes.js';
import { paintPasskeyWaiting, clearPasskeyWaiting } from '../utils/passkeyUi.js';
import { downloadWallet } from '../utils/warthogWalletUtils.js';
import { exportWalletFromWorker } from '../utils/signingBridge.js';
import { inspectWalletBlob } from '../utils/passkeyWallet.js';
import DexPriceChartsTool from './DexPriceChartsTool.jsx';
import DexVolumeGeneratorTool from './DexVolumeGeneratorTool.jsx';
import NumberDisplaySettings from './NumberDisplaySettings.jsx';
import WalletQrExportModal from './WalletQrExportModal.jsx';

function standardWalletFilename(walletName) {
  const tag = String(walletName || 'wallet')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 40) || 'wallet';
  return `warthog_wallet_${tag}.txt`;
}

const ToolsPage = ({ selectedNode: propSelectedNode, wallet: propWallet }) => {
  const {
    performFakeMine,
    isFakeMineAllowed,
    wallet: contextWallet,
    isSigningUnlocked,
    enablePasskeyOnCurrentWallet,
    currentWalletName,
  } = useWallet();
  const wallet = propWallet || contextWallet;
  const toast = useToast();

  const [address, setAddress] = useState('');
  const [validateResult, setValidateResult] = useState(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isMiningNow, setIsMiningNow] = useState(false);
  const [activeTool, setActiveTool] = useState('validate');
  const [showWalletExportQr, setShowWalletExportQr] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [backupPassword, setBackupPassword] = useState('');
  const [backupPassword2, setBackupPassword2] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [hasPasskey, setHasPasskey] = useState(false);

  const refreshPasskeyStatus = useCallback(() => {
    try {
      if (typeof localStorage === 'undefined' || !currentWalletName) {
        setHasPasskey(false);
        return;
      }
      const raw = localStorage.getItem(`warthogWallet_${currentWalletName}`);
      const info = inspectWalletBlob(raw);
      setHasPasskey(Boolean(info.hasPasskey));
    } catch {
      setHasPasskey(false);
    }
  }, [currentWalletName]);

  useEffect(() => {
    refreshPasskeyStatus();
  }, [refreshPasskeyStatus, isSigningUnlocked, wallet?.address]);

  const selectedNode = propSelectedNode || (() => {
    try {
      if (typeof localStorage === 'undefined') return DEFAULT_NODE_URL;
      return resolveSavedNodeUrl(localStorage.getItem('selectedNode'));
    } catch {
      return DEFAULT_NODE_URL;
    }
  })();

  const isDefi = isDefiNode(selectedNode);

  const toolOptions = useMemo(() => {
    const options = [
      { id: 'validate', label: 'Validate Address' },
      { id: 'mine', label: 'Mine Block' },
      { id: 'numbers', label: 'Number Display' },
    ];
    if (wallet) {
      options.push({ id: 'backup', label: 'Download Wallet File' });
      options.push({ id: 'mobile', label: 'Export QR' });
    }
    if (isDefi) {
      options.push(
        { id: 'charts', label: 'Price Charts' },
        { id: 'volume', label: 'Volume Generator' },
      );
    }
    return options;
  }, [isDefi, wallet]);

  useEffect(() => {
    if (wallet && toolOptions.some((t) => t.id === 'backup') && activeTool === 'validate') {
      setActiveTool('backup');
    }
  }, [wallet?.address]); // eslint-disable-line react-hooks/exhaustive-deps -- open backup when wallet attaches

  const resolvedTool = toolOptions.some((t) => t.id === activeTool)
    ? activeTool
    : 'validate';

  const activeToolLabel =
    toolOptions.find((t) => t.id === resolvedTool)?.label || resolvedTool;

  const handleValidateAddress = async () => {
    setIsValidating(true);
    try {
      setValidateResult(await validateWarthogAddressInput(address));
    } catch (err) {
      setValidateResult({ valid: false, error: err.message || 'Validation failed' });
    }
    setIsValidating(false);
  };

  const copyAddress = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Copied to clipboard');
    }).catch(() => toast.error('Failed to copy'));
  };

  const handleMineNow = async () => {
    setIsMiningNow(true);
    const ok = await performFakeMine();
    if (ok) {
      toast.success('Block mined — mempool transactions should confirm shortly');
    } else {
      toast.error('Fake mine failed — see status below or check node connection');
    }
    setIsMiningNow(false);
  };

  const handleEnablePasskey = async () => {
    if (!wallet || !isSigningUnlocked) {
      toast.error('Unlock your wallet first');
      return;
    }
    try {
      await paintPasskeyWaiting(setPasskeyBusy);
      const ok = await enablePasskeyOnCurrentWallet({ preferFingerprint: false, require2fa: false });
      if (ok) {
        refreshPasskeyStatus();
        toast.success(
          `Passkey enabled${currentWalletName ? ` for “${currentWalletName}”` : ''} — next login: Unlock with passkey`,
        );
      } else {
        toast.error('Could not enable passkey');
      }
    } finally {
      clearPasskeyWaiting(setPasskeyBusy);
    }
  };

  const backupFilename = standardWalletFilename(currentWalletName || 'wallet');

  const handleDownloadEncryptedWallet = async () => {
    if (!wallet || !isSigningUnlocked) {
      toast.error('Unlock your wallet first');
      return;
    }
    if (!backupPassword) {
      toast.error('Enter a password to encrypt the file');
      return;
    }
    if (backupPassword !== backupPassword2) {
      toast.error('Passwords do not match');
      return;
    }
    setBackupBusy(true);
    try {
      let walletData = wallet;
      if (!walletData?.privateKey) {
        walletData = await exportWalletFromWorker();
      }
      if (!walletData?.privateKey || !walletData?.address) {
        throw new Error('Could not export wallet keys — unlock and try again');
      }
      // Prefer session mnemonic when present (full seed backup)
      if (wallet?.mnemonic && !walletData.mnemonic) {
        walletData = { ...walletData, mnemonic: wallet.mnemonic, wordCount: wallet.wordCount, pathType: wallet.pathType };
      }
      const name = downloadWallet(walletData, backupPassword, { filename: backupFilename });
      toast.success(`Downloaded ${name} — store it safely offline`);
      setBackupPassword('');
      setBackupPassword2('');
    } catch (err) {
      toast.error(err?.message || 'Failed to download encrypted wallet');
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <section>
      <h2>Tools</h2>
      <p className="text-sm text-zinc-400 mb-4">
        Utility helpers for address checks, display preferences, mobile export QR, dev mining, and DEX tooling.
      </p>

      {passkeyBusy && (
        <div className="passkey-wait-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="passkey-wait-card">
            <div className="passkey-spinner" aria-hidden="true" />
            <p className="passkey-wait-title">Waiting for passkey…</p>
            <p className="passkey-wait-hint">
              Complete the browser or device prompt (PIN, biometrics, or password manager). This can take a moment.
            </p>
          </div>
        </div>
      )}

      {wallet && isSigningUnlocked ? (
        <div
          id="tools-passkey"
          className={`mb-6 p-4 rounded-xl border ${
            hasPasskey
              ? 'border-emerald-700/40 bg-emerald-950/25'
              : 'border-amber-600/50 bg-amber-950/25'
          }`}
        >
          <h3 className="text-base font-semibold text-zinc-100 m-0 mb-2">Passkey login</h3>
          {hasPasskey ? (
            <>
              <p className="text-sm text-emerald-400/90 mb-2 m-0 font-medium">
                ✓ Passkey already enabled
                {currentWalletName ? (
                  <>
                    {' '}
                    for <span className="font-mono">{currentWalletName}</span>
                  </>
                ) : null}
              </p>
              <p className="text-xs text-zinc-500 mb-3 m-0">
                Use <strong>Unlock with passkey</strong> on login. For offline backup, open{' '}
                <strong>Download Wallet File</strong> in the tool list below.
              </p>
              <button
                type="button"
                className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1.5 !w-full"
                disabled={passkeyBusy || backupBusy}
                onClick={handleEnablePasskey}
              >
                {passkeyBusy ? (
                  <>
                    <span className="btn-inline-spinner" aria-hidden="true" />
                    Waiting for passkey…
                  </>
                ) : (
                  'Re-register passkey'
                )}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-400 mb-3 m-0">
                One-tap unlock in this browser. Also use <strong>Download Wallet File</strong> below for offline
                backup.
              </p>
              <button
                type="button"
                className="wallet-action-btn w-full !mx-0 !min-h-[2.75rem] !font-bold"
                disabled={passkeyBusy || backupBusy}
                onClick={handleEnablePasskey}
              >
                {passkeyBusy ? (
                  <>
                    <span className="btn-inline-spinner" aria-hidden="true" />
                    Waiting for passkey…
                  </>
                ) : (
                  'Enable passkey'
                )}
              </button>
            </>
          )}
        </div>
      ) : null}

      <details className="group border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950/50 mb-6">
        <summary className="cursor-pointer list-none flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-zinc-900/80 transition-colors select-none">
          <div className="flex items-center gap-2 min-w-0">
            <span className="group-open:rotate-90 inline-block transition text-zinc-500 text-[10px] flex-shrink-0">
              ▶
            </span>
            <div className="min-w-0">
              <div className="text-xs text-zinc-300">Tool</div>
              <div className="text-[10px] text-zinc-500 truncate">
                Choose a utility to open below
              </div>
            </div>
          </div>
          <span
            className="compact-btn compact-btn--active !mx-0 !my-0 !px-3 !py-1 flex-shrink-0 pointer-events-none"
            aria-hidden="true"
          >
            {activeToolLabel}
          </span>
        </summary>
        <div className="px-3 pb-3 pt-2 border-t border-zinc-800">
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="tablist"
            aria-label="Tools"
          >
            {toolOptions.map((tool) => (
              <button
                key={tool.id}
                type="button"
                role="tab"
                aria-selected={resolvedTool === tool.id}
                onClick={() => setActiveTool(tool.id)}
                className={`compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1${
                  resolvedTool === tool.id ? ' compact-btn--active' : ''
                }`}
              >
                {tool.label}
              </button>
            ))}
          </div>
        </div>
      </details>

      {resolvedTool === 'validate' && (
        <div className="bg-zinc-950 border border-zinc-700 rounded-2xl p-5">
          <h3 className="text-base font-semibold text-white mb-1">Validate Address</h3>
          <p className="text-sm text-zinc-400 mb-4">
            Check a Warthog address locally — no node connection required.
          </p>
          <div className="form-group">
            <label>Address:</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value.trim())}
              placeholder="Enter address"
              className="input font-mono text-sm"
              onKeyDown={(e) => e.key === 'Enter' && handleValidateAddress()}
            />
          </div>
          <button
            onClick={handleValidateAddress}
            disabled={isValidating || !address}
            className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !px-3 !py-1"
          >
            {isValidating ? 'Validating…' : 'Validate Address'}
          </button>
          {validateResult && (
            <div
              className={`result mt-4 border ${
                validateResult.valid
                  ? 'border-zinc-700 bg-zinc-900/60'
                  : 'border-red-900/60 bg-red-950/20'
              }`}
            >
              {validateResult.valid ? (
                <>
                  <p className="text-[#FDB913] font-medium mb-3">{validateResult.message}</p>
                  <div className="text-[10px] text-zinc-500 mb-1">Address</div>
                  <span
                    className="wallet-address block cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => copyAddress(validateResult.fullAddress)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        copyAddress(validateResult.fullAddress);
                      }
                    }}
                  >
                    {validateResult.fullAddress}
                  </span>
                  <p className="text-[10px] text-zinc-500 mt-2">Click to copy</p>
                </>
              ) : (
                <p className="text-red-400 text-sm">{validateResult.error}</p>
              )}
            </div>
          )}
        </div>
      )}

      {resolvedTool === 'backup' && wallet && (
        <div className="bg-zinc-950 border border-sky-700/50 rounded-2xl p-5">
          <h3 className="text-base font-semibold text-white mb-1">Download encrypted wallet file</h3>
          <p className="text-sm text-zinc-400 mb-2 leading-relaxed">
            {hasPasskey
              ? 'Passkey is already enabled for browser login. Still download this file as an offline backup (file + password survives a browser wipe).'
              : 'Optional offline backup. Survives browser wipes if you keep the file and password.'}
          </p>
          <p className="text-xs text-zinc-500 mb-4">
            Filename: <code className="text-emerald-400/90">{backupFilename}</code>
            <br />
            Restore: login → <strong>Wallet file</strong>
          </p>
          {!isSigningUnlocked ? (
            <p className="text-sm text-amber-300/90 m-0">Unlock your wallet first (header → Unlock), then download.</p>
          ) : (
            <>
              <label className="block text-xs text-zinc-400 mb-1">Encrypt with password</label>
              <input
                type="password"
                className="input mb-2 w-full"
                value={backupPassword}
                onChange={(e) => setBackupPassword(e.target.value)}
                placeholder="Strong password"
                autoComplete="new-password"
                disabled={backupBusy}
              />
              <label className="block text-xs text-zinc-400 mb-1">Confirm password</label>
              <input
                type="password"
                className="input mb-3 w-full"
                value={backupPassword2}
                onChange={(e) => setBackupPassword2(e.target.value)}
                placeholder="Re-enter password"
                autoComplete="new-password"
                disabled={backupBusy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleDownloadEncryptedWallet();
                }}
              />
              <button
                type="button"
                className="wallet-action-btn w-full !m-0 !min-h-[2.75rem] !font-semibold"
                disabled={backupBusy || !backupPassword || backupPassword !== backupPassword2}
                onClick={handleDownloadEncryptedWallet}
              >
                {backupBusy ? (
                  <>
                    <span className="btn-inline-spinner" aria-hidden="true" />
                    Preparing file…
                  </>
                ) : (
                  'Download encrypted wallet file'
                )}
              </button>
            </>
          )}
        </div>
      )}

      {resolvedTool === 'mobile' && wallet && (
        <div className="bg-zinc-950 border border-zinc-700 rounded-2xl p-5">
          <h3 className="text-base font-semibold text-white mb-1">Transfer to Mobile App</h3>
          <p className="text-sm text-zinc-400 mb-4 leading-relaxed">
            Generate a password-encrypted QR code on this device, then scan it with the Warthog mobile
            wallet to import your keys. Your wallet must be unlocked.
          </p>
          <button
            type="button"
            onClick={() => setShowWalletExportQr(true)}
            disabled={!isSigningUnlocked}
            className="wallet-action-btn !m-0 font-semibold disabled:opacity-40"
          >
            {isSigningUnlocked ? 'Open Export QR' : 'Unlock Wallet First'}
          </button>
          {!isSigningUnlocked ? (
            <p className="mt-2 text-xs text-zinc-500">
              Use the Unlock button in the header if your wallet is locked.
            </p>
          ) : null}
        </div>
      )}

      {resolvedTool === 'numbers' && (
        <NumberDisplaySettings />
      )}

      {resolvedTool === 'mine' && (
        <div className="bg-zinc-950 border border-zinc-700 rounded-2xl p-5">
          <h3 className="text-base font-semibold text-white mb-1">Mine Block</h3>
          <p className="text-sm text-zinc-400 mb-4">
            Local dev helper — mines a block on your localhost node to confirm pending mempool transactions.
          </p>
          <button
            onClick={handleMineNow}
            disabled={!isFakeMineAllowed(selectedNode) || isMiningNow}
            className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !px-3 !py-1"
          >
            {isMiningNow ? 'Mining...' : '⛏️ Mine Now'}
          </button>
          <p className="mt-2 text-xs text-zinc-500">
            {isFakeMineAllowed(selectedNode)
              ? 'Available on your connected localhost node.'
              : 'Fake mining is disabled for remote/synced nodes. Point the app at localhost to use Mine Now.'}
          </p>
        </div>
      )}

      {resolvedTool === 'charts' && isDefi && (
        <DexPriceChartsTool selectedNode={selectedNode} />
      )}

      {resolvedTool === 'volume' && isDefi && (
        <DexVolumeGeneratorTool selectedNode={selectedNode} wallet={wallet} />
      )}

      <WalletQrExportModal
        open={showWalletExportQr}
        wallet={wallet}
        isSigningUnlocked={isSigningUnlocked}
        onClose={() => setShowWalletExportQr(false)}
      />
    </section>
  );
};

export default ToolsPage;