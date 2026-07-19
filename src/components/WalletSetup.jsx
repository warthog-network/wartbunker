import React, { useEffect, useMemo, useState } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import { encryptWallet, decryptWallet, downloadWallet } from '../utils/warthogWalletUtils';
import WarthogBrandHeader from './WarthogBrandHeader.jsx';

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

const ACCESS_METHODS = [
  {
    id: 'login',
    label: 'Saved wallet',
    hint: 'Unlock a named wallet already stored in this browser',
    cta: 'Login to Wallet',
  },
  {
    id: 'create',
    label: 'Create new',
    hint: 'Generate a fresh seed phrase and keys',
    cta: 'Create Wallet',
  },
  {
    id: 'derive',
    label: 'Seed phrase',
    hint: 'Recover from your 12 or 24 word mnemonic',
    cta: 'Recover Wallet',
  },
  {
    id: 'import',
    label: 'Private key',
    hint: 'Import from a 64-character private key',
    cta: 'Import Wallet',
  },
  {
    id: 'load',
    label: 'Wallet file',
    hint: 'Open a portable encrypted warthog_wallet.txt',
    cta: 'Decrypt Wallet & Login',
  },
];

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
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <div className="login-password-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="input login-password-input"
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
        />
        <button
          type="button"
          className="login-password-toggle"
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

const WalletSetup = () => {
  const { setCurrentTab, activateWalletSession } = useWallet();
  const toast = useToast();

  const savedWallets = useMemo(() => getSavedWallets(), []);
  const hasSavedWallets = savedWallets.length > 0;

  // Prefer login when this browser already has named wallets.
  const [walletAction, setWalletAction] = useState(() =>
    hasSavedWallets ? 'login' : 'create',
  );
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

  const activeMethod = ACCESS_METHODS.find((m) => m.id === walletAction) || ACCESS_METHODS[0];

  // Keep background from scrolling while the tall wallet-info modal is open
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

  const handleActionChange = (value) => {
    setWalletAction(value);
    setError(null);
    setPassword('');
    setConfirmPassword('');
    setMnemonic('');
    setPrivateKeyInput('');
    setUploadedFile(null);
    if (value === 'login' && savedWallets.length > 0 && !selectedSavedWallet) {
      setSelectedSavedWallet(savedWallets[0]);
    }
  };

  const handleWalletAction = async () => {
    if (isBusy) return;
    setError(null);
    try {
      if (walletAction === 'login') {
        if (!selectedSavedWallet || !password) {
          setError('Select a saved wallet and enter its password');
          return;
        }
        setIsBusy(true);
        const encrypted = localStorage.getItem(`warthogWallet_${selectedSavedWallet}`);
        if (!encrypted) {
          setError('Selected wallet not found in this browser');
          setIsBusy(false);
          return;
        }
        try {
          const decrypted = decryptWallet(encrypted, password);
          await activateWalletSession(decrypted, selectedSavedWallet);
          setCurrentTab('overview');
          toast.success(`Welcome back, ${selectedSavedWallet}`);
        } catch (err) {
          const msg = err?.message || 'Unknown error';
          setError(
            msg === 'Invalid password'
              ? 'Invalid password — try again'
              : `Login failed: ${msg}`,
          );
        } finally {
          setIsBusy(false);
        }
        return;
      }

      if (walletAction === 'load') {
        if (!uploadedFile || !password) {
          setError('Upload the wallet file and enter the encryption password');
          return;
        }
        setIsBusy(true);
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const decrypted = decryptWallet(e.target.result, password);
            await activateWalletSession(decrypted, null);
            setCurrentTab('overview');
            setShowModal(false);
            toast.success('Wallet loaded successfully');
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
        return;
      }

      setIsBusy(true);
      const { generateWallet, deriveWallet, importFromPrivateKey } = await import('../utils/warthogWallet.js');

      let wallet;
      if (walletAction === 'create') {
        wallet = await generateWallet(wordCount, pathType);
      } else if (walletAction === 'derive') {
        if (!mnemonic.trim()) {
          setError('Enter your seed phrase');
          setIsBusy(false);
          return;
        }
        wallet = await deriveWallet(mnemonic.trim(), wordCount, pathType);
      } else if (walletAction === 'import') {
        if (!privateKeyInput) {
          setError('Enter a private key');
          setIsBusy(false);
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
      if (walletAction !== 'load') setIsBusy(false);
    }
  };

  const handleSaveWallet = async () => {
    if (!saveWalletConsent || !walletName || !password || password !== confirmPassword) {
      setError('Provide a wallet name, matching passwords, and consent to save');
      return;
    }
    setIsBusy(true);
    try {
      const encrypted = encryptWallet(walletData, password);
      const name = walletName.trim();
      localStorage.setItem(`warthogWallet_${name}`, encrypted);
      await activateWalletSession(walletData, name);
      setCurrentTab('overview');
      setShowModal(false);
      setError(null);
      toast.success(`Wallet saved as "${name}" in this browser`);
    } catch (err) {
      setError('Failed to save wallet: ' + err.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleDownloadWalletFile = () => {
    if (!downloadPassword) {
      setError('Enter a password to encrypt the wallet file before downloading');
      return;
    }
    try {
      downloadWallet(walletData, downloadPassword);
      setError(null);
      toast.success('Encrypted wallet file downloaded (warthog_wallet.txt)');
    } catch (err) {
      setError('Failed to download wallet file: ' + err.message);
    }
  };

  const handleUseNow = async () => {
    if (!consentToClose) {
      setError('Confirm you have saved the seed / private key securely');
      return;
    }
    setIsBusy(true);
    try {
      await activateWalletSession(walletData, null);
      setCurrentTab('overview');
      setShowModal(false);
      setError(null);
      toast.success('Wallet ready — consider saving it for quick login');
    } catch (err) {
      setError('Failed to use wallet: ' + err.message);
    } finally {
      setIsBusy(false);
    }
  };

  const copyToClipboard = (text, label = 'Copied') => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      toast.success(label);
    }).catch(() => toast.error('Failed to copy'));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleWalletAction();
  };

  const acceptWalletFile = (file) => {
    if (!file) return;
    setUploadedFile(file);
    setError(null);
  };

  const handleWalletFileInput = (e) => {
    acceptWalletFile(e.target.files?.[0] ?? null);
    e.target.value = '';
  };

  const handleWalletFileDrop = (e) => {
    e.preventDefault();
    setWalletFileDragActive(false);
    acceptWalletFile(e.dataTransfer.files?.[0] ?? null);
  };

  const canSubmit =
    !isBusy && (
      walletAction === 'create'
      || (walletAction === 'derive' && mnemonic.trim().length > 0)
      || (walletAction === 'import' && privateKeyInput.length > 0)
      || (walletAction === 'login' && !!password && !!selectedSavedWallet && savedWallets.length > 0)
      || (walletAction === 'load' && !!password && !!uploadedFile)
    );

  const passwordsMatch = !confirmPassword || password === confirmPassword;
  const canSaveBrowser =
    consentToClose
    && saveWalletConsent
    && walletName.trim()
    && password
    && password === confirmPassword
    && !isBusy;

  return (
    <div className="container login-setup">
      <WarthogBrandHeader className="mb-6" />

      <section className="login-flow">
        <header className="login-flow__header">
          <h2 className="login-flow__title">Wallet Access</h2>
          <p className="login-flow__hint">{activeMethod.hint}</p>
        </header>

        {/* Single-row method tabs — all options, low vertical cost */}
        <div
          className="login-method-tabs"
          role="tablist"
          aria-label="Wallet access methods"
        >
          {ACCESS_METHODS.map((method) => {
            const isActive = walletAction === method.id;
            const disabledLogin = method.id === 'login' && !hasSavedWallets;
            return (
              <button
                key={method.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                disabled={disabledLogin}
                title={
                  disabledLogin
                    ? 'No wallets saved in this browser yet'
                    : method.hint
                }
                onClick={() => handleActionChange(method.id)}
                className={`login-method-tab${isActive ? ' login-method-tab--active' : ''}`}
              >
                {method.label}
              </button>
            );
          })}
        </div>

        <div className="login-flow__body">
          {walletAction === 'login' && (
            <>
              <div className="form-group">
                <label className="login-field-label">Wallet</label>
                {savedWallets.length > 0 ? (
                  <div className="login-wallet-list" role="listbox" aria-label="Saved wallets">
                    {savedWallets.map((name) => {
                      const isSelected = selectedSavedWallet === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => { setSelectedSavedWallet(name); setError(null); }}
                          className={`login-wallet-row${isSelected ? ' login-wallet-row--selected' : ''}`}
                          disabled={isBusy}
                        >
                          <span className="login-wallet-row__name">{name}</span>
                          {isSelected && <span className="login-wallet-row__mark">Selected</span>}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">
                    No saved wallets here. Create one, or open a wallet file.
                  </p>
                )}
              </div>
              <PasswordField
                id="login-password"
                label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Wallet password"
                autoComplete="current-password"
                autoFocus={hasSavedWallets}
                disabled={isBusy}
              />
            </>
          )}

          {walletAction === 'load' && (
            <>
              <div className="form-group">
                <label className="login-field-label" htmlFor="wallet-file-input">Wallet file</label>
                <div
                  className={`login-file-row${walletFileDragActive ? ' login-file-row--active' : ''}${
                    uploadedFile ? ' login-file-row--ready' : ''
                  }`}
                  onDragEnter={(e) => { e.preventDefault(); setWalletFileDragActive(true); }}
                  onDragOver={(e) => { e.preventDefault(); setWalletFileDragActive(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setWalletFileDragActive(false); }}
                  onDrop={handleWalletFileDrop}
                >
                  <input
                    id="wallet-file-input"
                    type="file"
                    accept=".txt,text/plain"
                    onChange={handleWalletFileInput}
                    className="sr-only"
                    disabled={isBusy}
                  />
                  <span className="login-file-row__name">
                    {uploadedFile ? uploadedFile.name : 'warthog_wallet.txt — drop or browse'}
                  </span>
                  <label htmlFor="wallet-file-input" className="login-file-row__browse">
                    {uploadedFile ? 'Change' : 'Browse'}
                  </label>
                </div>
              </div>
              <PasswordField
                id="file-password"
                label="File password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Encryption password"
                autoComplete="current-password"
                disabled={isBusy}
              />
            </>
          )}

          {walletAction === 'create' && (
            <div className="login-options-row">
              <div className="form-group !mb-0">
                <label className="login-field-label" htmlFor="create-word-count">Word count</label>
                <select
                  id="create-word-count"
                  value={wordCount}
                  onChange={(e) => setWordCount(e.target.value)}
                  className="input"
                  disabled={isBusy}
                >
                  <option value="12">12 words</option>
                  <option value="24">24 words (more secure)</option>
                </select>
              </div>
              <div className="form-group !mb-0">
                <label className="login-field-label" htmlFor="create-path-type">Derivation path</label>
                <select
                  id="create-path-type"
                  value={pathType}
                  onChange={(e) => setPathType(e.target.value)}
                  className="input"
                  disabled={isBusy}
                >
                  <option value="hardened">Hardened, BIP44 (Default)</option>
                  <option value="legacy">Legacy</option>
                </select>
              </div>
            </div>
          )}

          {walletAction === 'derive' && (
            <>
              <div className="form-group">
                <label className="login-field-label" htmlFor="seed-phrase">Seed phrase</label>
                <textarea
                  id="seed-phrase"
                  value={mnemonic}
                  onChange={(e) => setMnemonic(e.target.value)}
                  placeholder="12 or 24 word seed phrase"
                  className="input login-seed-input"
                  rows="3"
                  disabled={isBusy}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="login-options-row">
                <div className="form-group !mb-0">
                  <label className="login-field-label" htmlFor="derive-word-count">Word count</label>
                  <select
                    id="derive-word-count"
                    value={wordCount}
                    onChange={(e) => setWordCount(e.target.value)}
                    className="input"
                    disabled={isBusy}
                  >
                    <option value="12">12 words</option>
                    <option value="24">24 words</option>
                  </select>
                </div>
                <div className="form-group !mb-0">
                  <label className="login-field-label" htmlFor="derive-path-type">Path</label>
                  <select
                    id="derive-path-type"
                    value={pathType}
                    onChange={(e) => setPathType(e.target.value)}
                    className="input"
                    disabled={isBusy}
                  >
                    <option value="hardened">Hardened, BIP44</option>
                    <option value="legacy">Legacy</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {walletAction === 'import' && (
            <div className="form-group !mb-0">
              <label className="login-field-label" htmlFor="private-key">Private key</label>
              <input
                id="private-key"
                type="text"
                value={privateKeyInput}
                onChange={(e) => setPrivateKeyInput(e.target.value.trim())}
                onKeyDown={handleKeyDown}
                placeholder="64-character private key (hex)"
                className="input font-mono text-sm"
                disabled={isBusy}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}

          <div className="login-flow__actions">
            <button
              type="button"
              onClick={handleWalletAction}
              disabled={!canSubmit}
              className="wallet-action-btn login-primary-cta"
            >
              {isBusy
                ? (walletAction === 'login' || walletAction === 'load'
                  ? 'Unlocking…'
                  : walletAction === 'create'
                    ? 'Generating…'
                    : 'Working…')
                : activeMethod.cta}
            </button>
          </div>

          {error && !showModal && (
            <div className="login-error" role="alert">
              <p>{error}</p>
            </div>
          )}
        </div>
      </section>

      {showModal && walletData && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="wallet-info-title">
          <div className="modal-content wallet-info-modal">
            <div className="wallet-info-modal__header">
              <h2 id="wallet-info-title" className="!mb-0">Secure your wallet</h2>
              <p className="text-xs text-zinc-500 mt-1 mb-0">
                Back up secrets first, then save or continue. All options below remain available.
              </p>
            </div>

            <div className="wallet-info-modal__scroll">
              <div className="login-modal-step">
                <div className="login-modal-step__badge">1</div>
                <div className="login-modal-step__body">
                  <div className="login-modal-step__title">Write down your secrets</div>
                  <div className="rounded-xl bg-amber-950/60 border border-amber-900/70 px-4 py-3 text-sm text-amber-300 mb-3">
                    <strong>Critical:</strong> Store seed phrase and private key offline. Never share them. Anyone with this information can steal your funds.
                  </div>
                  {walletData.mnemonic && (
                    <div className="result min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-medium text-amber-400 min-w-0">SEED PHRASE (SAVE THIS SECURELY)</span>
                        <button type="button" onClick={() => copyToClipboard(walletData.mnemonic, 'Seed phrase copied')} className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !mt-0 !px-3 !py-1">COPY</button>
                      </div>
                      <pre onClick={() => copyToClipboard(walletData.mnemonic, 'Seed phrase copied')} className="cursor-pointer select-all whitespace-pre-wrap break-words [overflow-wrap:anywhere] max-w-full">{walletData.mnemonic}</pre>
                    </div>
                  )}
                  <div className="result min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-medium text-red-400 min-w-0">PRIVATE KEY — NEVER SHARE</span>
                      <button type="button" onClick={() => copyToClipboard(walletData.privateKey, 'Private key copied')} className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !mt-0 !px-3 !py-1">COPY</button>
                    </div>
                    <pre onClick={() => copyToClipboard(walletData.privateKey, 'Private key copied')} className="cursor-pointer select-all whitespace-pre-wrap break-all [overflow-wrap:anywhere] max-w-full">{walletData.privateKey}</pre>
                  </div>
                  <div className="result min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-medium text-zinc-400 min-w-0">Public Key</span>
                      <button type="button" onClick={() => copyToClipboard(walletData.publicKey, 'Public key copied')} className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !mt-0 !px-3 !py-1">COPY</button>
                    </div>
                    <pre onClick={() => copyToClipboard(walletData.publicKey)} className="cursor-pointer select-all text-xs whitespace-pre-wrap break-all [overflow-wrap:anywhere] max-w-full">{walletData.publicKey}</pre>
                  </div>
                  <div className="result min-w-0 !mb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-medium text-emerald-400 min-w-0">Address</span>
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
                  <div className="rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-300 space-y-2 mb-3">
                    <p className="font-medium text-zinc-100 !mb-1">Where can this wallet be saved?</p>
                    <ul className="list-disc pl-5 space-y-1.5 text-zinc-400 text-[13px] leading-relaxed">
                      <li>
                        <span className="text-zinc-200">This browser only</span> — encrypted in local storage and shown under
                        Saved wallet next time you open Bunker <em>here</em>. Not the same as a downloaded file.
                      </li>
                      <li>
                        <span className="text-zinc-200">Encrypted wallet file</span> — download{' '}
                        <span className="font-mono text-zinc-300">warthog_wallet.txt</span>. Move it to another PC or browser and open with Wallet file.
                      </li>
                      <li>
                        Seed phrase / private key above are the ultimate backup. The mnemonic is never stored in the browser or file — only spendable keys.
                      </li>
                    </ul>
                  </div>

                  <div className="form-group">
                    <label className="login-checkbox-label">
                      <input
                        type="checkbox"
                        checked={saveWalletConsent}
                        onChange={(e) => setSaveWalletConsent(e.target.checked)}
                      />
                      Save in this browser (encrypted with a password)
                    </label>
                  </div>
                  {saveWalletConsent && (
                    <div className="login-save-fields">
                      <p className="text-xs text-zinc-500 -mt-1 mb-3 leading-relaxed">
                        Saved in this browser for quick login. Clearing site data or a different browser will not show it — download a file backup for portability.
                      </p>
                      <div className="form-group">
                        <label className="login-field-label" htmlFor="new-wallet-name">Wallet name</label>
                        <input
                          id="new-wallet-name"
                          type="text"
                          value={walletName}
                          onChange={(e) => setWalletName(e.target.value)}
                          placeholder="e.g. main or trading"
                          className="input"
                          autoComplete="off"
                        />
                      </div>
                      <PasswordField
                        id="save-password"
                        label="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Choose a strong password"
                        autoComplete="new-password"
                      />
                      <PasswordField
                        id="save-password-confirm"
                        label="Confirm password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                        autoComplete="new-password"
                      />
                      {!passwordsMatch && (
                        <p className="text-xs text-red-400 -mt-2 mb-2">Passwords do not match</p>
                      )}
                    </div>
                  )}

                  <div className="form-group border-t border-zinc-800 pt-3 mt-1 mb-0">
                    <label className="login-field-label">Optional: download encrypted wallet file</label>
                    <p className="text-xs text-zinc-500 mb-2 leading-relaxed">
                      Portable backup for another device. Use a strong password — anyone with the file and password can access the wallet.
                    </p>
                    <div className="login-password-wrap">
                      <input
                        type="password"
                        value={downloadPassword}
                        onChange={(e) => setDownloadPassword(e.target.value)}
                        placeholder="Password to encrypt the file"
                        className="input login-password-input"
                        autoComplete="new-password"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleDownloadWalletFile}
                      disabled={!downloadPassword}
                      className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !mt-2 !px-3 !py-1 !w-full"
                    >
                      Download Encrypted Wallet File
                    </button>
                  </div>
                </div>
              </div>

              {error && showModal && (
                <div className="login-error" role="alert"><p>{error}</p></div>
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
                <span>I have saved the seed phrase / private key securely <span className="text-zinc-500">(required)</span></span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleUseNow}
                  disabled={!consentToClose || isBusy}
                  className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !mt-0 !px-3 !py-1.5 flex-1 font-semibold"
                >
                  {isBusy ? 'Opening…' : 'Use Wallet Now'}
                </button>
                <button
                  type="button"
                  onClick={handleSaveWallet}
                  disabled={!canSaveBrowser}
                  className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !mt-0 !px-3 !py-1.5 flex-1 font-semibold"
                >
                  Save in This Browser
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
    </div>
  );
};

export default WalletSetup;
