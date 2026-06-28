import React, { useState } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import { encryptWallet, decryptWallet } from '../utils/warthogWalletUtils';
import WarthogBrandHeader from './WarthogBrandHeader.jsx';

const WalletSetup = () => {
  const { setCurrentTab, activateWalletSession } = useWallet();
  const toast = useToast();

  const savedWallets = getSavedWallets();
  const [walletAction, setWalletAction] = useState('create');
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
  const [selectedSavedWallet, setSelectedSavedWallet] = useState('');

  const handleWalletAction = async () => {
    setError(null);
    try {
      if (walletAction === 'login') {
        if (!selectedSavedWallet || !password) {
          setError('Please select a saved wallet and enter password');
          return;
        }
        const encrypted = localStorage.getItem(`warthogWallet_${selectedSavedWallet}`);
        if (!encrypted) {
          setError('Selected wallet not found');
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
              ? 'Invalid password'
              : `Login failed: ${msg}`,
          );
        }
        return;
      }

      if (walletAction === 'load') {
        if (!uploadedFile || !password) {
          setError('Please upload the wallet file and enter password');
          return;
        }
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
          }
        };
        reader.readAsText(uploadedFile);
        return;
      }

      const { generateWallet, deriveWallet, importFromPrivateKey } = await import('../utils/warthogWallet.js');

      let wallet;
      if (walletAction === 'create') {
        wallet = await generateWallet(wordCount, pathType);
      } else if (walletAction === 'derive') {
        if (!mnemonic) {
          setError('Please enter a mnemonic phrase');
          return;
        }
        wallet = await deriveWallet(mnemonic, wordCount, pathType);
      } else if (walletAction === 'import') {
        if (!privateKeyInput) {
          setError('Please enter a private key');
          return;
        }
        wallet = await importFromPrivateKey(privateKeyInput);
      }

      if (wallet) {
        setWalletData(wallet);
        setShowModal(true);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSaveWallet = async () => {
    if (!saveWalletConsent || !walletName || !password || password !== confirmPassword) {
      setError('Please provide a wallet name, matching passwords and consent to save');
      return;
    }
    try {
      const encrypted = encryptWallet(walletData, password);
      const name = walletName.trim();
      localStorage.setItem(`warthogWallet_${name}`, encrypted);
      await activateWalletSession(walletData, name);
      setCurrentTab('overview');
      setShowModal(false);
      setError(null);
      toast.success(`Wallet saved as "${name}"`);
    } catch (err) {
      setError('Failed to save wallet: ' + err.message);
    }
  };

  const handleUseNow = async () => {
    if (!consentToClose) {
      setError('Please confirm you have saved the seed/private key securely');
      return;
    }
    try {
      await activateWalletSession(walletData, null);
      setCurrentTab('overview');
      setShowModal(false);
      setError(null);
      toast.success('Wallet ready — consider saving it for quick login');
    } catch (err) {
      setError('Failed to use wallet: ' + err.message);
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

  return (
    <div className="container">
      <WarthogBrandHeader className="mb-5" />

      <section>
        <h2>Login to Existing Wallet</h2>
        <p className="mb-4 text-gray-600 dark:text-gray-400">
          If you have a saved encrypted wallet file, use the button below to login.
        </p>
        <button
          onClick={() => { setWalletAction('load'); setError(null); }}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-2xl transition-colors w-full mb-6"
        >
          Login with Encrypted Wallet File
        </button>
      </section>

      <section>
        <h2>Wallet Setup</h2>

        <div className="form-group">
          <label>Action:</label>
          <select
            value={walletAction}
            onChange={(e) => { setWalletAction(e.target.value); setError(null); }}
            className="input"
          >
            <option value="create">Create New Wallet</option>
            <option value="derive">Derive from Mnemonic</option>
            <option value="import">Import Private Key</option>
            <option value="login">Login to Saved Wallet</option>
            <option value="load">Login with Encrypted File</option>
          </select>
        </div>

        {walletAction === 'login' && (
          <>
            <div className="form-group">
              <label>Select Saved Wallet:</label>
              {savedWallets.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                  {savedWallets.map((name) => {
                    const isSelected = selectedSavedWallet === name;
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => { setSelectedSavedWallet(name); setError(null); }}
                        className={`saved-wallet-card${isSelected ? ' saved-wallet-card--selected' : ''}`}
                        aria-pressed={isSelected}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="saved-wallet-card__name">{name}</div>
                            <div className="saved-wallet-card__meta">
                              {isSelected ? 'Selected' : 'Saved in this browser'}
                            </div>
                          </div>
                          <span className="saved-wallet-card__check" aria-hidden="true">
                            {isSelected && (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5">
                                <path d="M10.28 2.28a.75.75 0 0 1 0 1.06l-5.5 5.5a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 1 1 1.06-1.06L4.5 7.19l4.97-4.97a.75.75 0 0 1 1.06 0Z" />
                              </svg>
                            )}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-zinc-500 mt-1">
                  No saved wallets yet. Create a wallet and save it for quick login.
                </p>
              )}
            </div>
            <div className="form-group">
              <label>Password:</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter password"
                className="input"
                autoComplete="current-password"
              />
            </div>
          </>
        )}

        {walletAction === 'load' && (
          <>
            <div className="form-group">
              <label>Upload Wallet File:</label>
              <div
                className={`rounded-xl border border-dashed p-5 text-center transition-colors ${
                  walletFileDragActive
                    ? 'border-[#E79300] bg-[#E79300]/10'
                    : 'border-zinc-600 bg-zinc-900/40'
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
                />
                {uploadedFile ? (
                  <div className="space-y-2">
                    <p className="text-sm text-[#FDB913] font-medium break-all">{uploadedFile.name}</p>
                    <label htmlFor="wallet-file-input" className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1 cursor-pointer inline-block">
                      Choose a different file
                    </label>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-zinc-300">Drag your encrypted wallet file here</p>
                    <label htmlFor="wallet-file-input" className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1 cursor-pointer inline-block">
                      Browse for file
                    </label>
                  </div>
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-2">
                If the file picker shows a missing USB path, plug the drive back in or open your home folder in the picker and try again. Drag-and-drop also works.
              </p>
            </div>
            <div className="form-group">
              <label>Password:</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter password"
                className="input"
                autoComplete="current-password"
              />
            </div>
          </>
        )}

        {walletAction === 'create' && (
          <>
            <div className="form-group">
              <label>Word Count:</label>
              <select value={wordCount} onChange={(e) => setWordCount(e.target.value)} className="input">
                <option value="12">12 words</option>
                <option value="24">24 words</option>
              </select>
            </div>
            <div className="form-group">
              <label>Path Type:</label>
              <select value={pathType} onChange={(e) => setPathType(e.target.value)} className="input">
                <option value="hardened">Hardened (BIP44)</option>
                <option value="legacy">Legacy</option>
              </select>
            </div>
          </>
        )}

        {walletAction === 'derive' && (
          <>
            <div className="form-group">
              <label>Mnemonic:</label>
              <textarea
                value={mnemonic}
                onChange={(e) => setMnemonic(e.target.value)}
                placeholder="Enter your 12 or 24 word mnemonic"
                className="input"
                rows="4"
              />
            </div>
            <div className="form-group">
              <label>Word Count:</label>
              <select value={wordCount} onChange={(e) => setWordCount(e.target.value)} className="input">
                <option value="12">12 words</option>
                <option value="24">24 words</option>
              </select>
            </div>
            <div className="form-group">
              <label>Path Type:</label>
              <select value={pathType} onChange={(e) => setPathType(e.target.value)} className="input">
                <option value="hardened">Hardened (BIP44)</option>
                <option value="legacy">Legacy</option>
              </select>
            </div>
          </>
        )}

        {walletAction === 'import' && (
          <div className="form-group">
            <label>Private Key:</label>
            <input
              type="text"
              value={privateKeyInput}
              onChange={(e) => setPrivateKeyInput(e.target.value.trim())}
              onKeyDown={handleKeyDown}
              placeholder="Enter 64-character private key"
              className="input"
            />
          </div>
        )}

        <button
          onClick={handleWalletAction}
          disabled={(walletAction === 'load' && (!password || !uploadedFile)) || (walletAction === 'login' && (!password || !selectedSavedWallet))}
          className="px-4 py-2 text-sm font-medium text-white bg-zinc-700 rounded-lg hover:bg-zinc-800 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200 dark:bg-zinc-600 dark:hover:bg-zinc-700 dark:focus:ring-zinc-800 w-full"
        >
          {walletAction === 'create'
            ? 'Create Wallet'
            : walletAction === 'derive'
            ? 'Derive Wallet'
            : walletAction === 'import'
            ? 'Import Wallet'
            : walletAction === 'login'
            ? 'Login to Wallet'
            : 'Decrypt Wallet & Login'}
        </button>

        {error && <div className="error"><p>{error}</p></div>}
      </section>

      {showModal && walletData && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Wallet Information</h2>
            <div className="rounded-xl bg-amber-950/60 border border-amber-900/70 px-4 py-3 text-sm text-amber-300">
              <strong>Critical:</strong> Write your seed phrase and private key on paper and store them offline. Never share them. Anyone with this information can steal your funds.
            </div>
            {walletData.mnemonic && (
              <div className="result">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-amber-400">MNEMONIC (SAVE THIS SECURELY)</span>
                  <button onClick={() => copyToClipboard(walletData.mnemonic, 'Mnemonic copied')} className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-white">COPY</button>
                </div>
                <pre onClick={() => copyToClipboard(walletData.mnemonic, 'Mnemonic copied')} className="cursor-pointer select-all">{walletData.mnemonic}</pre>
              </div>
            )}
            <div className="result">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-red-400">PRIVATE KEY — NEVER SHARE</span>
                <button onClick={() => copyToClipboard(walletData.privateKey, 'Private key copied')} className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-white">COPY</button>
              </div>
              <pre onClick={() => copyToClipboard(walletData.privateKey, 'Private key copied')} className="cursor-pointer select-all">{walletData.privateKey}</pre>
            </div>
            <div className="result">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-zinc-400">Public Key</span>
                <button onClick={() => copyToClipboard(walletData.publicKey, 'Public key copied')} className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-white">COPY</button>
              </div>
              <pre onClick={() => copyToClipboard(walletData.publicKey)} className="cursor-pointer select-all text-xs">{walletData.publicKey}</pre>
            </div>
            <div className="result">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-emerald-400">Address</span>
                <button onClick={() => copyToClipboard(walletData.address, 'Address copied')} className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-white">COPY</button>
              </div>
              <pre onClick={() => copyToClipboard(walletData.address, 'Address copied')} className="cursor-pointer select-all font-mono text-sm">{walletData.address}</pre>
            </div>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={saveWalletConsent}
                  onChange={(e) => setSaveWalletConsent(e.target.checked)}
                />
                I consent to save the wallet encrypted with a password (optional)
              </label>
            </div>
            {saveWalletConsent && (
              <>
                <div className="form-group">
                  <label>Wallet Name:</label>
                  <input
                    type="text"
                    value={walletName}
                    onChange={(e) => setWalletName(e.target.value)}
                    placeholder="Enter a name for your wallet (e.g. main)"
                    className="input"
                  />
                </div>
                <div className="form-group">
                  <label>Password:</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="input"
                  />
                </div>
                <div className="form-group">
                  <label>Confirm Password:</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    className="input"
                  />
                </div>
              </>
            )}
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={consentToClose}
                  onChange={(e) => setConsentToClose(e.target.checked)}
                />
                I have saved the seed phrase / private key securely (required)
              </label>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                onClick={handleUseNow}
                disabled={!consentToClose}
                style={{ flex: 1 }}
              >
                Use Wallet Now
              </button>
              <button
                onClick={handleSaveWallet}
                disabled={!consentToClose || !saveWalletConsent || !walletName || !password || password !== confirmPassword}
                style={{ flex: 1 }}
              >
                Save Named Wallet
              </button>
            </div>
            <button
              onClick={() => setShowModal(false)}
              style={{ marginTop: '0.25rem', background: 'transparent', color: '#888', border: '1px solid #444' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

function getSavedWallets() {
  try {
    if (typeof localStorage === 'undefined') return [];
    return Object.keys(localStorage)
      .filter((key) => key.startsWith('warthogWallet_'))
      .map((key) => key.replace('warthogWallet_', ''));
  } catch {
    return [];
  }
}

export default WalletSetup;