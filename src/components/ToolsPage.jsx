import React, { useState } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import { validateWarthogAddressInput } from '../utils/warthogFormat.js';
import { DEFAULT_NODE_URL } from '../utils/presetNodes.js';

const ToolsPage = ({ selectedNode: propSelectedNode }) => {
  const { performFakeMine, isFakeMineAllowed } = useWallet();
  const toast = useToast();

  const [address, setAddress] = useState('');
  const [validateResult, setValidateResult] = useState(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isMiningNow, setIsMiningNow] = useState(false);
  const selectedNode = propSelectedNode || (() => {
    try {
      if (typeof localStorage === 'undefined') return DEFAULT_NODE_URL;
      return localStorage.getItem('selectedNode') || DEFAULT_NODE_URL;
    } catch {
      return DEFAULT_NODE_URL;
    }
  })();

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

  return (
    <section>
      <h2>Tools</h2>
      <p className="text-sm text-zinc-400 mb-4">
        Validate a Warthog address locally — no node connection required.
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
        className="wallet-action-btn disabled:opacity-60"
      >
        {isValidating ? 'Validating…' : 'Validate Address'}
      </button>
      {validateResult && (
        <div
          className={`result mt-4 border ${
            validateResult.valid
              ? 'border-emerald-800/60 bg-emerald-950/20'
              : 'border-red-900/60 bg-red-950/20'
          }`}
        >
          {validateResult.valid ? (
            <>
              <p className="text-emerald-400 font-medium mb-3">{validateResult.message}</p>
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

      <details className="result mt-6 group" style={{ textAlign: 'left' }}>
        <summary className="cursor-pointer font-semibold text-zinc-400 hover:text-zinc-300 flex items-center gap-2 select-none">
          <span className="group-open:rotate-90 inline-block transition text-xs">▶</span>
          Dev Tools
        </summary>

        <div className="mt-4 pt-4 border-t border-zinc-800">
          <p className="font-semibold mb-3 text-emerald-400">Testnet Mining</p>

          <button
            onClick={handleMineNow}
            disabled={!isFakeMineAllowed(selectedNode) || isMiningNow}
            className="w-full py-3 font-semibold rounded-2xl transition-all bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isMiningNow ? 'Mining...' : '⛏️ Mine Now'}
          </button>

          <p className="mt-2 text-xs text-zinc-500">
            {isFakeMineAllowed(selectedNode)
              ? 'Local dev only: mines a block on your localhost node to confirm pending mempool transactions.'
              : 'Fake mining is disabled for remote/synced nodes. Point the app at localhost to use Mine Now.'}
          </p>
        </div>
      </details>
    </section>
  );
};

export default ToolsPage;
