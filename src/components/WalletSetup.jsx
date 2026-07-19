import React, { useState } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import { encryptWallet, decryptWallet, downloadWallet } from '../utils/warthogWalletUtils';
import WarthogBrandHeader from './WarthogBrandHeader.jsx';

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

const WalletSetup = () => {
  const { setCurrentTab, activateWalletSession } = useWallet();
  const toast = useToast();

  const savedWallets = getSavedWallets();
  const hasSavedWallets = savedWallets.length > 0;

  // Single action menu: default to login when this browser already has named wallets.
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
          setError('Please enter a seed phrase');
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
        setSaveWalletConsent(false);
        setConsentToClose(false);
        setWalletName('');
        setPassword('');
        setConfirmPassword('');
        setDownloadPassword('');
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
      toast.success(`Wallet saved as "${name}" in this browser`);
    } catch (err) {
      setError('Failed to save wallet: ' + err.message);
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

  const primaryButtonLabel =
    walletAction === 'create'
      ? 'Create Wallet'
      : walletAction === 'derive'
        ? 'Recover Wallet'
        : walletAction === 'import'
          ? 'Import Wallet'
          : walletAction === 'login'
            ? 'Login to Wallet'
            : 'Decrypt Wallet & Login';

  return (
    <div className="container">
      <WarthogBrandHeader className="mb-5" />

      <section>
        <h2>Wallet Access</h2>
        <p className="mb-4 text-sm text-zinc-400">
          {hasSavedWallets
            ? 'Saved wallets were found in this browser. Choose an action below — login is selected by default.'
            : 'No saved wallets in this browser yet. Create one, or recover with a seed phrase, private key, or encrypted file.'}
        </p>

        <div className="form-group">
          <label>Action:</label>
          <select
            value={walletAction}
            onChange={(e) => handleActionChange(e.target.value)}
            className="input"
          >
            <option value="login">Login to Saved Wallet</option>
            <option value="create">Create New Wallet</option>
            <option value="derive">Recover from Seed Phrase</option>
            <option value="import">Import Private Key</option>
            <option value="load">Login with Encrypted Wallet File</option>
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
                  No saved wallets in this browser. Create a wallet and choose &quot;Save in this browser&quot;,
                  or switch to &quot;Login with Encrypted Wallet File&quot; if you have a download.
                </p>
              )}
              <p className="text-xs text-zinc-500 mt-2">
                Named wallets live only in this browser&apos;s storage (not a downloadable file).
                To use another device or browser, download an encrypted wallet file when you create/save a wallet.
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

        {walletAction === 'load' && (
          <>
            <p className="text-sm text-zinc-400 mb-3">
              Use a portable <span className="text-zinc-200">warthog_wallet.txt</span> file you previously downloaded.
              This is different from wallets saved only in this browser — files can be moved to another PC or browser.
            </p>
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
                placeholder="Enter password used to encrypt the file"
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
                <option value="24">24 words (more secure)</option>
              </select>
            </div>
            <div className="form-group">
              <label>Path Type:</label>
              <select value={pathType} onChange={(e) => setPathType(e.target.value)} className="input">
                <option value="hardened">Hardened, BIP44 (Default)</option>
                <option value="legacy">Legacy</option>
              </select>
              <p className="text-xs text-zinc-500 mt-1.5">
                Not sure? Keep <span className="text-zinc-400">Hardened, BIP44 (Default)</span>. Only choose Legacy if you already use that path elsewhere.
              </p>
            </div>
          </>
        )}

        {walletAction === 'derive' && (
          <>
            <div className="form-group">
              <label>Seed Phrase:</label>
              <textarea
                value={mnemonic}
                onChange={(e) => setMnemonic(e.target.value)}
                placeholder="Enter your 12 or 24 word seed phrase"
                className="input"
                rows="4"
              />
            </div>
            <div className="form-group">
              <label>Word Count:</label>
              <select value={wordCount} onChange={(e) => setWordCount(e.target.value)} className="input">
                <option value="12">12 words</option>
                <option value="24">24 words (more secure)</option>
              </select>
            </div>
            <div className="form-group">
              <label>Path Type:</label>
              <select value={pathType} onChange={(e) => setPathType(e.target.value)} className="input">
                <option value="hardened">Hardened, BIP44 (Default)</option>
                <option value="legacy">Legacy</option>
              </select>
              <p className="text-xs text-zinc-500 mt-1.5">
                Use the same path type you used when the wallet was created.
              </p>
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
          disabled={
            (walletAction === 'load' && (!password || !uploadedFile))
            || (walletAction === 'login' && (!password || !selectedSavedWallet || savedWallets.length === 0))
          }
          className="px-4 py-2 text-sm font-medium text-white bg-zinc-700 rounded-lg hover:bg-zinc-800 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200 dark:bg-zinc-600 dark:hover:bg-zinc-700 dark:focus:ring-zinc-800 w-full"
        >
          {primaryButtonLabel}
        </button>

        {error && !showModal && (
          <div className="error"><p>{error}</p></div>
        )}
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
                  <span className="text-xs font-medium text-amber-400">SEED PHRASE (SAVE THIS SECURELY)</span>
                  <button type="button" onClick={() => copyToClipboard(walletData.mnemonic, 'Seed phrase copied')} className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !mt-0 !px-3 !py-1">COPY</button>
                </div>
                <pre onClick={() => copyToClipboard(walletData.mnemonic, 'Seed phrase copied')} className="cursor-pointer select-all">{walletData.mnemonic}</pre>
              </div>
            )}
            <div className="result">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-red-400">PRIVATE KEY — NEVER SHARE</span>
                <button type="button" onClick={() => copyToClipboard(walletData.privateKey, 'Private key copied')} className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !mt-0 !px-3 !py-1">COPY</button>
              </div>
              <pre onClick={() => copyToClipboard(walletData.privateKey, 'Private key copied')} className="cursor-pointer select-all">{walletData.privateKey}</pre>
            </div>
            <div className="result">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-zinc-400">Public Key</span>
                <button type="button" onClick={() => copyToClipboard(walletData.publicKey, 'Public key copied')} className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !mt-0 !px-3 !py-1">COPY</button>
              </div>
              <pre onClick={() => copyToClipboard(walletData.publicKey)} className="cursor-pointer select-all text-xs">{walletData.publicKey}</pre>
            </div>
            <div className="result">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-emerald-400">Address</span>
                <button type="button" onClick={() => copyToClipboard(walletData.address, 'Address copied')} className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !mt-0 !px-3 !py-1">COPY</button>
              </div>
              <pre onClick={() => copyToClipboard(walletData.address, 'Address copied')} className="cursor-pointer select-all font-mono text-sm">{walletData.address}</pre>
            </div>

            <div className="rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-300 space-y-2 mt-1">
              <p className="font-medium text-zinc-100">Where can this wallet be saved?</p>
              <ul className="list-disc pl-5 space-y-1.5 text-zinc-400 text-[13px] leading-relaxed">
                <li>
                  <span className="text-zinc-200">This browser only</span> — encrypted in local storage and shown under
                  &quot;Login to Saved Wallet&quot; next time you open Bunker <em>in this same browser</em>.
                  It is <strong className="font-medium text-zinc-300">not</strong> the same as a downloaded file.
                </li>
                <li>
                  <span className="text-zinc-200">Encrypted wallet file</span> — download <span className="font-mono text-zinc-300">warthog_wallet.txt</span>.
                  You can move that file to another PC or browser and open it with
                  &quot;Login with Encrypted Wallet File&quot;.
                </li>
                <li>
                  Seed phrase / private key (above) are the ultimate backup. Mnemonic is never stored in the browser or file — only the keys needed to spend.
                </li>
              </ul>
            </div>

            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={saveWalletConsent}
                  onChange={(e) => setSaveWalletConsent(e.target.checked)}
                />
                Save in this browser (encrypted with a password)
              </label>
            </div>
            {saveWalletConsent && (
              <>
                <p className="text-xs text-zinc-500 -mt-1 mb-2">
                  The wallet will be saved in your browser and will be detected the next time you try to login here.
                  Clearing site data or using a different browser will not show it — download a file backup if you need portability.
                </p>
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
                    autoComplete="new-password"
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
                    autoComplete="new-password"
                  />
                </div>
              </>
            )}

            <div className="form-group border-t border-zinc-800 pt-3 mt-1">
              <label className="text-zinc-300">Optional: download encrypted wallet file</label>
              <p className="text-xs text-zinc-500 mb-2">
                Portable backup you can copy to another device. Use a strong password — anyone with the file and password can access the wallet.
              </p>
              <input
                type="password"
                value={downloadPassword}
                onChange={(e) => setDownloadPassword(e.target.value)}
                placeholder="Password to encrypt the file"
                className="input"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={handleDownloadWalletFile}
                disabled={!downloadPassword}
                className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !mt-2 !px-3 !py-1 !w-full"
              >
                Download Encrypted Wallet File
              </button>
            </div>

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

            {error && showModal && (
              <div className="error"><p>{error}</p></div>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-2">
              <button
                type="button"
                onClick={handleUseNow}
                disabled={!consentToClose}
                className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !mt-0 !px-3 !py-1 flex-1"
              >
                Use Wallet Now
              </button>
              <button
                type="button"
                onClick={handleSaveWallet}
                disabled={!consentToClose || !saveWalletConsent || !walletName || !password || password !== confirmPassword}
                className="compact-btn hover:!text-[#E79300] disabled:opacity-40 !mx-0 !my-0 !mt-0 !px-3 !py-1 flex-1"
              >
                Save in This Browser
              </button>
            </div>
            <button
              type="button"
              onClick={() => { setShowModal(false); setError(null); }}
              className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !mt-2 !px-3 !py-1 !w-full"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WalletSetup;
