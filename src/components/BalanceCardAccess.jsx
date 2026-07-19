import React, { useEffect, useMemo, useState } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import { encryptWallet, decryptWallet, downloadWallet } from '../utils/warthogWalletUtils';

function getSavedWallets() {
  try {
    if (typeof localStorage === 'undefined') return [];
    return Object.keys(localStorage)
      .filter((key) => key.startsWith('warthogWallet_'))
      .map((key) => key.replace('warthogWallet_', ''))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  } catch {
    return [];
  }
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  onKeyDown,
  placeholder,
  autoComplete = 'current-password',
  autoFocus = false,
  disabled = false,
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="bca-field">
      <label htmlFor={id} className="bca-label">{label}</label>
      <div className="bca-password-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="input bca-password-input"
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
        />
        <button
          type="button"
          className="bca-password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

/**
 * Guided wallet access — lives inside the Home balance card when logged out.
 * One path at a time; never dumps every method on screen.
 */
const BalanceCardAccess = () => {
  const { setCurrentTab, activateWalletSession } = useWallet();
  const toast = useToast();

  const savedWallets = useMemo(() => getSavedWallets(), []);
  const hasSavedWallets = savedWallets.length > 0;

  // hub | login | create | have | derive | import | load
  const [path, setPath] = useState('hub');
  const [mnemonic, setMnemonic] = useState('');
  const [privateKeyInput, setPrivateKeyInput] = useState('');
  const [wordCount, setWordCount] = useState('12');
  const [pathType, setPathType] = useState('hardened');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [walletFileDragActive, setWalletFileDragActive] = useState(false);
  const [saveWalletConsent, setSaveWalletConsent] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [walletData, setWalletData] = useState(null);
  const [consentToClose, setConsentToClose] = useState(false);
  const [error, setError] = useState(null);
  const [walletName, setWalletName] = useState('');
  const [selectedSavedWallet, setSelectedSavedWallet] = useState(() =>
    hasSavedWallets ? savedWallets[0] : '',
  );
  const [downloadPassword, setDownloadPassword] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!showModal) return undefined;
    const prevOverflow = document.body.style.overflow;
    const prevTouch = document.body.style.touchAction;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouch;
    };
  }, [showModal]);

  const goPath = (next) => {
    setPath(next);
    setError(null);
    setPassword('');
    setConfirmPassword('');
    setMnemonic('');
    setPrivateKeyInput('');
    setUploadedFile(null);
    if (next === 'login' && savedWallets.length > 0 && !selectedSavedWallet) {
      setSelectedSavedWallet(savedWallets[0]);
    }
  };

  const finishSession = async (wallet, name = null) => {
    await activateWalletSession(wallet, name);
    setCurrentTab('overview');
  };

  const handleLogin = async () => {
    if (!selectedSavedWallet || !password) {
      setError('Select a wallet and enter its password');
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      const encrypted = localStorage.getItem(`warthogWallet_${selectedSavedWallet}`);
      if (!encrypted) {
        setError('Selected wallet not found in this browser');
        return;
      }
      const decrypted = decryptWallet(encrypted, password);
      await finishSession(decrypted, selectedSavedWallet);
      toast.success(`Welcome back, ${selectedSavedWallet}`);
    } catch (err) {
      const msg = err?.message || 'Unknown error';
      setError(msg === 'Invalid password' ? 'Invalid password — try again' : `Login failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleLoadFile = async () => {
    if (!uploadedFile || !password) {
      setError('Choose a file and enter its password');
      return;
    }
    setIsBusy(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const decrypted = decryptWallet(e.target.result, password);
        await finishSession(decrypted, null);
        toast.success('Wallet loaded');
      } catch (err) {
        setError('Failed to load wallet: ' + err.message);
      } finally {
        setIsBusy(false);
      }
    };
    reader.onerror = () => {
      setError('Could not read the wallet file');
      setIsBusy(false);
    };
    reader.readAsText(uploadedFile);
  };

  const handleGenerateOrRecover = async (action) => {
    setIsBusy(true);
    setError(null);
    try {
      const { generateWallet, deriveWallet, importFromPrivateKey } = await import('../utils/warthogWallet.js');
      let wallet;
      if (action === 'create') {
        wallet = await generateWallet(wordCount, pathType);
      } else if (action === 'derive') {
        if (!mnemonic.trim()) {
          setError('Enter your seed phrase');
          return;
        }
        wallet = await deriveWallet(mnemonic.trim(), wordCount, pathType);
      } else if (action === 'import') {
        if (!privateKeyInput) {
          setError('Enter a private key');
          return;
        }
        wallet = await importFromPrivateKey(privateKeyInput);
      }
      if (wallet) {
        setWalletData(wallet);
        setShowModal(true);
        setSaveWalletConsent(false);
        setConsentToClose(false);
        setWalletName('');
        setPassword('');
        setConfirmPassword('');
        setDownloadPassword('');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveWallet = async () => {
    if (!saveWalletConsent || !walletName || !password || password !== confirmPassword) {
      setError('Provide a name, matching passwords, and consent to save');
      return;
    }
    setIsBusy(true);
    try {
      const encrypted = encryptWallet(walletData, password);
      const name = walletName.trim();
      localStorage.setItem(`warthogWallet_${name}`, encrypted);
      await finishSession(walletData, name);
      setShowModal(false);
      setError(null);
      toast.success(`Saved as "${name}" in this browser`);
    } catch (err) {
      setError('Failed to save wallet: ' + err.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleDownloadWalletFile = () => {
    if (!downloadPassword) {
      setError('Enter a password to encrypt the file');
      return;
    }
    try {
      downloadWallet(walletData, downloadPassword);
      setError(null);
      toast.success('Encrypted wallet file downloaded');
    } catch (err) {
      setError('Failed to download: ' + err.message);
    }
  };

  const handleUseNow = async () => {
    if (!consentToClose) {
      setError('Confirm you saved the seed / private key');
      return;
    }
    setIsBusy(true);
    try {
      await finishSession(walletData, null);
      setShowModal(false);
      setError(null);
      toast.success('Wallet ready');
    } catch (err) {
      setError('Failed to open wallet: ' + err.message);
    } finally {
      setIsBusy(false);
    }
  };

  const copyToClipboard = (text, label = 'Copied') => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => toast.success(label)).catch(() => toast.error('Failed to copy'));
  };

  const acceptWalletFile = (file) => {
    if (!file) return;
    setUploadedFile(file);
    setError(null);
  };

  const passwordsMatch = !confirmPassword || password === confirmPassword;
  const canSaveBrowser =
    consentToClose
    && saveWalletConsent
    && walletName.trim()
    && password
    && password === confirmPassword
    && !isBusy;

  const pathTitle = {
    hub: hasSavedWallets ? 'Welcome back' : 'Get started',
    login: 'Unlock wallet',
    create: 'Create wallet',
    have: 'Restore wallet',
    derive: 'Seed phrase',
    import: 'Private key',
    load: 'Wallet file',
  }[path] || 'Wallet';

  const pathHint = {
    hub: hasSavedWallets
      ? 'Unlock a wallet saved in this browser, or start another path.'
      : 'Create a new wallet, or restore one you already have.',
    login: 'Choose a saved wallet and enter its password.',
    create: 'Generate keys in this browser. You’ll back up the seed next.',
    have: 'How do you want to restore access?',
    derive: 'Enter the 12 or 24 word phrase for this wallet.',
    import: 'Paste the 64-character private key.',
    load: 'Open an encrypted warthog_wallet.txt file.',
  }[path] || '';

  const showBack = path !== 'hub';
  const backTarget = ['derive', 'import', 'load'].includes(path) ? 'have' : 'hub';

  return (
    <>
      <div className="bca">
        <div className="bca-head">
          {showBack ? (
            <button type="button" className="bca-back" onClick={() => goPath(backTarget)} disabled={isBusy}>
              ← Back
            </button>
          ) : (
            <span className="bca-kicker">No wallet open</span>
          )}
          <h3 className="bca-title">{pathTitle}</h3>
          <p className="bca-hint">{pathHint}</p>
        </div>

        {/* ── Hub: only primary choices ── */}
        {path === 'hub' && (
          <div className="bca-paths">
            {hasSavedWallets && (
              <button type="button" className="bca-path bca-path--primary" onClick={() => goPath('login')}>
                <span className="bca-path__label">Unlock saved wallet</span>
                <span className="bca-path__meta">
                  {savedWallets.length} in this browser
                </span>
              </button>
            )}
            <button
              type="button"
              className={`bca-path${hasSavedWallets ? '' : ' bca-path--primary'}`}
              onClick={() => goPath('create')}
            >
              <span className="bca-path__label">Create new wallet</span>
              <span className="bca-path__meta">Fresh seed phrase</span>
            </button>
            <button type="button" className="bca-path" onClick={() => goPath('have')}>
              <span className="bca-path__label">
                {hasSavedWallets ? 'Other restore options' : 'I already have a wallet'}
              </span>
              <span className="bca-path__meta">Seed, key, or file</span>
            </button>
          </div>
        )}

        {/* ── Have a wallet: next step only ── */}
        {path === 'have' && (
          <div className="bca-paths">
            {hasSavedWallets && (
              <button type="button" className="bca-path" onClick={() => goPath('login')}>
                <span className="bca-path__label">Saved in this browser</span>
                <span className="bca-path__meta">{savedWallets.length} wallet{savedWallets.length === 1 ? '' : 's'}</span>
              </button>
            )}
            <button type="button" className="bca-path" onClick={() => goPath('derive')}>
              <span className="bca-path__label">Seed phrase</span>
              <span className="bca-path__meta">12 or 24 words</span>
            </button>
            <button type="button" className="bca-path" onClick={() => goPath('import')}>
              <span className="bca-path__label">Private key</span>
              <span className="bca-path__meta">64-character hex</span>
            </button>
            <button type="button" className="bca-path" onClick={() => goPath('load')}>
              <span className="bca-path__label">Encrypted file</span>
              <span className="bca-path__meta">warthog_wallet.txt</span>
            </button>
          </div>
        )}

        {/* ── Login ── */}
        {path === 'login' && (
          <div className="bca-form">
            <div className="bca-field">
              <span className="bca-label">Wallet</span>
              <div className="bca-paths" role="listbox" aria-label="Saved wallets">
                {savedWallets.map((name) => {
                  const selected = selectedSavedWallet === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`bca-path${selected ? ' bca-path--primary' : ''}`}
                      onClick={() => { setSelectedSavedWallet(name); setError(null); }}
                      disabled={isBusy}
                    >
                      <span className="bca-path__label font-mono">{name}</span>
                      <span className="bca-path__meta">
                        {selected ? 'Selected' : 'Saved in this browser'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <PasswordField
              id="bca-login-pw"
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="Wallet password"
              autoFocus
              disabled={isBusy}
            />
            <button
              type="button"
              className="wallet-action-btn bca-cta"
              disabled={isBusy || !password || !selectedSavedWallet}
              onClick={handleLogin}
            >
              {isBusy ? 'Unlocking…' : 'Unlock'}
            </button>
          </div>
        )}

        {/* ── Create ── */}
        {path === 'create' && (
          <div className="bca-form">
            <div className="bca-field">
              <label className="bca-label" htmlFor="bca-words">Word count</label>
              <select id="bca-words" className="input" value={wordCount} onChange={(e) => setWordCount(e.target.value)} disabled={isBusy}>
                <option value="12">12 words</option>
                <option value="24">24 words</option>
              </select>
            </div>
            <div className="bca-field">
              <label className="bca-label" htmlFor="bca-path">Path</label>
              <select id="bca-path" className="input" value={pathType} onChange={(e) => setPathType(e.target.value)} disabled={isBusy}>
                <option value="hardened">Hardened BIP44</option>
                <option value="legacy">Legacy</option>
              </select>
            </div>
            <button
              type="button"
              className="wallet-action-btn bca-cta"
              disabled={isBusy}
              onClick={() => handleGenerateOrRecover('create')}
            >
              {isBusy ? 'Generating…' : 'Create wallet'}
            </button>
          </div>
        )}

        {/* ── Derive ── */}
        {path === 'derive' && (
          <div className="bca-form">
            <div className="bca-field">
              <label className="bca-label" htmlFor="bca-seed">Seed phrase</label>
              <textarea
                id="bca-seed"
                className="input bca-seed"
                rows={3}
                value={mnemonic}
                onChange={(e) => setMnemonic(e.target.value)}
                placeholder="12 or 24 words"
                disabled={isBusy}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="bca-field">
              <label className="bca-label" htmlFor="bca-dwords">Words</label>
              <select id="bca-dwords" className="input" value={wordCount} onChange={(e) => setWordCount(e.target.value)} disabled={isBusy}>
                <option value="12">12</option>
                <option value="24">24</option>
              </select>
            </div>
            <div className="bca-field">
              <label className="bca-label" htmlFor="bca-dpath">Path</label>
              <select id="bca-dpath" className="input" value={pathType} onChange={(e) => setPathType(e.target.value)} disabled={isBusy}>
                <option value="hardened">BIP44</option>
                <option value="legacy">Legacy</option>
              </select>
            </div>
            <button
              type="button"
              className="wallet-action-btn bca-cta"
              disabled={isBusy || !mnemonic.trim()}
              onClick={() => handleGenerateOrRecover('derive')}
            >
              {isBusy ? 'Working…' : 'Recover wallet'}
            </button>
          </div>
        )}

        {/* ── Import ── */}
        {path === 'import' && (
          <div className="bca-form">
            <div className="bca-field">
              <label className="bca-label" htmlFor="bca-pk">Private key</label>
              <input
                id="bca-pk"
                type="text"
                className="input font-mono text-sm"
                value={privateKeyInput}
                onChange={(e) => setPrivateKeyInput(e.target.value.trim())}
                onKeyDown={(e) => e.key === 'Enter' && handleGenerateOrRecover('import')}
                placeholder="64-character hex"
                disabled={isBusy}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <button
              type="button"
              className="wallet-action-btn bca-cta"
              disabled={isBusy || !privateKeyInput}
              onClick={() => handleGenerateOrRecover('import')}
            >
              {isBusy ? 'Working…' : 'Import wallet'}
            </button>
          </div>
        )}

        {/* ── Load file ── */}
        {path === 'load' && (
          <div className="bca-form">
            <div className="bca-field">
              <span className="bca-label">Wallet file</span>
              <div
                className={`bca-dropzone${walletFileDragActive ? ' bca-dropzone--active' : ''}${
                  uploadedFile ? ' bca-dropzone--ready' : ''
                }`}
                onDragEnter={(e) => { e.preventDefault(); setWalletFileDragActive(true); }}
                onDragOver={(e) => { e.preventDefault(); setWalletFileDragActive(true); }}
                onDragLeave={(e) => { e.preventDefault(); setWalletFileDragActive(false); }}
                onDrop={(e) => {
                  e.preventDefault();
                  setWalletFileDragActive(false);
                  acceptWalletFile(e.dataTransfer.files?.[0] ?? null);
                }}
              >
                <input
                  id="bca-file"
                  type="file"
                  accept=".txt,text/plain"
                  className="sr-only"
                  disabled={isBusy}
                  onChange={(e) => {
                    acceptWalletFile(e.target.files?.[0] ?? null);
                    e.target.value = '';
                  }}
                />
                {uploadedFile ? (
                  <div className="space-y-2">
                    <p className="text-sm text-[#FDB913] font-medium break-all">{uploadedFile.name}</p>
                    <label
                      htmlFor="bca-file"
                      className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1 cursor-pointer inline-block"
                    >
                      Choose a different file
                    </label>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-zinc-300">Drag your encrypted wallet file here</p>
                    <p className="text-[11px] text-zinc-500">or</p>
                    <label
                      htmlFor="bca-file"
                      className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1 cursor-pointer inline-block"
                    >
                      Browse for file
                    </label>
                  </div>
                )}
              </div>
            </div>
            <PasswordField
              id="bca-file-pw"
              label="File password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLoadFile()}
              placeholder="Encryption password"
              disabled={isBusy}
            />
            <button
              type="button"
              className="wallet-action-btn bca-cta"
              disabled={isBusy || !password || !uploadedFile}
              onClick={handleLoadFile}
            >
              {isBusy ? 'Unlocking…' : 'Open file'}
            </button>
          </div>
        )}

        {error && !showModal && (
          <div className="bca-error" role="alert">{error}</div>
        )}
      </div>

      {showModal && walletData && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="bca-wallet-info-title">
          <div className="modal-content wallet-info-modal">
            <div className="wallet-info-modal__header">
              <h2 id="bca-wallet-info-title" className="!mb-0">Secure your wallet</h2>
              <p className="text-xs text-zinc-500 mt-1 mb-0">
                Back up secrets first, then save or continue.
              </p>
            </div>

            <div className="wallet-info-modal__scroll">
              <div className="login-modal-step">
                <div className="login-modal-step__badge">1</div>
                <div className="login-modal-step__body">
                  <div className="login-modal-step__title">Write down your secrets</div>
                  <div className="rounded-xl bg-amber-950/60 border border-amber-900/70 px-4 py-3 text-sm text-amber-300 mb-3">
                    <strong>Critical:</strong> Store seed and private key offline. Never share them.
                  </div>
                  {walletData.mnemonic && (
                    <div className="result min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-medium text-amber-400">SEED PHRASE</span>
                        <button type="button" onClick={() => copyToClipboard(walletData.mnemonic, 'Seed copied')} className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !mt-0 !px-3 !py-1">COPY</button>
                      </div>
                      <pre onClick={() => copyToClipboard(walletData.mnemonic, 'Seed copied')} className="cursor-pointer select-all whitespace-pre-wrap break-words [overflow-wrap:anywhere] max-w-full">{walletData.mnemonic}</pre>
                    </div>
                  )}
                  <div className="result min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-medium text-red-400">PRIVATE KEY</span>
                      <button type="button" onClick={() => copyToClipboard(walletData.privateKey, 'Key copied')} className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !mt-0 !px-3 !py-1">COPY</button>
                    </div>
                    <pre onClick={() => copyToClipboard(walletData.privateKey, 'Key copied')} className="cursor-pointer select-all whitespace-pre-wrap break-all [overflow-wrap:anywhere] max-w-full">{walletData.privateKey}</pre>
                  </div>
                  <div className="result min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-medium text-zinc-400">Public Key</span>
                      <button type="button" onClick={() => copyToClipboard(walletData.publicKey, 'Public key copied')} className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !mt-0 !px-3 !py-1">COPY</button>
                    </div>
                    <pre onClick={() => copyToClipboard(walletData.publicKey)} className="cursor-pointer select-all text-xs whitespace-pre-wrap break-all [overflow-wrap:anywhere] max-w-full">{walletData.publicKey}</pre>
                  </div>
                  <div className="result min-w-0 !mb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-medium text-emerald-400">Address</span>
                      <button type="button" onClick={() => copyToClipboard(walletData.address, 'Address copied')} className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !mt-0 !px-3 !py-1">COPY</button>
                    </div>
                    <pre onClick={() => copyToClipboard(walletData.address, 'Address copied')} className="cursor-pointer select-all font-mono text-sm whitespace-pre-wrap break-all [overflow-wrap:anywhere] max-w-full">{walletData.address}</pre>
                  </div>
                </div>
              </div>

              <div className="login-modal-step">
                <div className="login-modal-step__badge">2</div>
                <div className="login-modal-step__body">
                  <div className="login-modal-step__title">Optional: save for later</div>
                  <label className="login-checkbox-label mb-3">
                    <input
                      type="checkbox"
                      checked={saveWalletConsent}
                      onChange={(e) => setSaveWalletConsent(e.target.checked)}
                    />
                    Save in this browser (encrypted)
                  </label>
                  {saveWalletConsent && (
                    <div className="login-save-fields">
                      <div className="bca-field mb-3">
                        <label className="bca-label" htmlFor="bca-wname">Wallet name</label>
                        <input
                          id="bca-wname"
                          type="text"
                          className="input"
                          value={walletName}
                          onChange={(e) => setWalletName(e.target.value)}
                          placeholder="e.g. main"
                          autoComplete="off"
                        />
                      </div>
                      <PasswordField
                        id="bca-save-pw"
                        label="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Strong password"
                        autoComplete="new-password"
                      />
                      <PasswordField
                        id="bca-save-pw2"
                        label="Confirm password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                        autoComplete="new-password"
                      />
                      {!passwordsMatch && (
                        <p className="text-xs text-red-400 -mt-1 mb-2">Passwords do not match</p>
                      )}
                    </div>
                  )}
                  <div className="border-t border-zinc-800 pt-3 mt-2">
                    <label className="bca-label">Optional: download encrypted file</label>
                    <input
                      type="password"
                      className="input mb-2"
                      value={downloadPassword}
                      onChange={(e) => setDownloadPassword(e.target.value)}
                      placeholder="Password for the file"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={handleDownloadWalletFile}
                      disabled={!downloadPassword}
                      className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !px-3 !py-1 !w-full"
                    >
                      Download warthog_wallet.txt
                    </button>
                  </div>
                </div>
              </div>

              {error && showModal && (
                <div className="bca-error" role="alert">{error}</div>
              )}
            </div>

            <div className="wallet-info-modal__actions">
              <label className="flex items-start gap-2 text-sm text-zinc-300 mb-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentToClose}
                  onChange={(e) => setConsentToClose(e.target.checked)}
                  className="mt-0.5 flex-shrink-0"
                />
                <span>I saved the seed / private key securely</span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleUseNow}
                  disabled={!consentToClose || isBusy}
                  className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !mt-0 !px-3 !py-1.5 flex-1 font-semibold"
                >
                  {isBusy ? 'Opening…' : 'Use wallet now'}
                </button>
                <button
                  type="button"
                  onClick={handleSaveWallet}
                  disabled={!canSaveBrowser}
                  className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !mt-0 !px-3 !py-1.5 flex-1 font-semibold"
                >
                  Save in browser
                </button>
              </div>
              <button
                type="button"
                onClick={() => { setShowModal(false); setError(null); }}
                className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !mt-2 !px-3 !py-1 !w-full"
                disabled={isBusy}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BalanceCardAccess;
