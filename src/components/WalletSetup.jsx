import React, { useState } from 'react';
import { useWallet } from './WalletContext';
import { generateWallet, deriveWallet, importFromPrivateKey, encryptWallet, decryptWallet } from '../utils/warthogWalletUtils';

const WalletSetup = () => {
  const { setWallet, setIsLoggedIn, setCurrentTab } = useWallet();

  const [walletAction, setWalletAction] = useState('create');
  const [mnemonic, setMnemonic] = useState('');
  const [privateKeyInput, setPrivateKeyInput] = useState('');
  const [wordCount, setWordCount] = useState('12');
  const [pathType, setPathType] = useState('hardened');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [saveWalletConsent, setSaveWalletConsent] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [walletData, setWalletData] = useState(null);
  const [consentToClose, setConsentToClose] = useState(false);
  const [error, setError] = useState(null);

  const handleWalletAction = async () => {
    setError(null);
    try {
      if (walletAction === 'load') {
        if (!uploadedFile || !password) {
          setError('Please upload the wallet file and enter password');
          return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const decrypted = decryptWallet(e.target.result, password);
            setWallet(decrypted);
            sessionStorage.setItem('warthogWalletDecrypted', JSON.stringify(decrypted));
            setIsLoggedIn(true);
            setCurrentTab('overview');
            setShowModal(false);
          } catch (err) {
            setError('Failed to load wallet: ' + err.message);
          }
        };
        reader.readAsText(uploadedFile);
        return;
      }

      let wallet;
      if (walletAction === 'create') {
        wallet = generateWallet(wordCount, pathType);
      } else if (walletAction === 'derive') {
        if (!mnemonic) {
          setError('Please enter a mnemonic phrase');
          return;
        }
        wallet = deriveWallet(mnemonic, wordCount, pathType);
      } else if (walletAction === 'import') {
        if (!privateKeyInput) {
          setError('Please enter a private key');
          return;
        }
        wallet = importFromPrivateKey(privateKeyInput);
      }

      if (wallet) {
        setWalletData(wallet);
        setShowModal(true);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSaveWallet = () => {
    if (!saveWalletConsent || !password || password !== confirmPassword) {
      setError('Please provide matching passwords and consent to save');
      return;
    }
    try {
      const encrypted = encryptWallet(walletData, password);
      localStorage.setItem('warthogWallet', encrypted);
      setWallet(walletData);
      sessionStorage.setItem('warthogWalletDecrypted', JSON.stringify(walletData));
      setIsLoggedIn(true);
      setCurrentTab('overview');
      setShowModal(false);
      setError(null);
    } catch (err) {
      setError('Failed to save wallet: ' + err.message);
    }
  };

  return (
    <div className="container">
      <h1>Warthog Network Defi</h1>

      <section>
        <h2>Wallet Setup</h2>

        <div className="form-group">
          <label>Action:</label>
          <select value={walletAction} onChange={(e) => setWalletAction(e.target.value)} className="input">
            <option value="create">Create New Wallet</option>
            <option value="derive">Derive from Mnemonic</option>
            <option value="import">Import Private Key</option>
            <option value="load">Login with Encrypted File</option>
          </select>
        </div>

        {walletAction === 'load' && (
          <>
            <div className="form-group">
              <label>Upload Wallet File:</label>
              <input type="file" accept=".txt" onChange={(e) => setUploadedFile(e.target.files[0])} className="input" />
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
              placeholder="Enter 64-character private key"
              className="input"
            />
          </div>
        )}

        <button 
          onClick={handleWalletAction} 
          disabled={walletAction === 'load' && (!password || !uploadedFile)}
          className="px-4 py-2 text-sm font-medium text-white bg-zinc-700 rounded-lg hover:bg-zinc-800 focus:ring-4 focus:outline-none focus:ring-zinc-300 transition-colors duration-200 dark:bg-zinc-600 dark:hover:bg-zinc-700 dark:focus:ring-zinc-800 w-full"
        >
          {walletAction === 'create' 
            ? 'Create Wallet' 
            : walletAction === 'derive' 
            ? 'Derive Wallet' 
            : walletAction === 'import' 
            ? 'Import Wallet' 
            : 'Decrypt Wallet & Login'}
        </button>

        {error && <div className="error"><p>{error}</p></div>}
      </section>

      {showModal && walletData && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Wallet Information</h2>
            <p className="warning">
              Warning: Please write down your seed phrase (if available) and private key on a piece of paper and store them securely. Do not share them with anyone.
            </p>
            {walletData.mnemonic && (
              <div className="result">
                <p><strong>Mnemonic:</strong></p>
                <pre>{walletData.mnemonic}</pre>
              </div>
            )}
            <div className="result">
              <p><strong>Private Key:</strong></p>
              <pre>{walletData.privateKey}</pre>
            </div>
            <div className="result">
              <p><strong>Public Key:</strong></p>
              <pre>{walletData.publicKey}</pre>
            </div>
            <div className="result">
              <p><strong>Address:</strong></p>
              <pre>{walletData.address}</pre>
            </div>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={saveWalletConsent}
                  onChange={(e) => setSaveWalletConsent(e.target.checked)}
                />
                I consent to save the wallet encrypted with a password
              </label>
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
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={consentToClose}
                  onChange={(e) => setConsentToClose(e.target.checked)}
                />
                I have saved the information securely
              </label>
            </div>
            <button onClick={handleSaveWallet}>Save Wallet</button>
            <button onClick={() => setShowModal(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WalletSetup;
