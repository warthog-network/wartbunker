import React, { useState } from 'react';
import { useWallet } from './WalletContext';
import { useToast } from './Toast';
import { createWarthogApi, getNodeData } from '../utils/warthogClient.js';

const ToolsPage = ({ selectedNode: propSelectedNode }) => {
  const { performFakeMine, isFakeMineAllowed } = useWallet();
  const toast = useToast();

  const [address, setAddress] = useState('');
  const [validateResult, setValidateResult] = useState(null);
  const [isMiningNow, setIsMiningNow] = useState(false);
  const selectedNode = propSelectedNode || (() => {
    try {
      if (typeof localStorage === 'undefined') return 'https://warthognode.duckdns.org';
      return localStorage.getItem('selectedNode') || 'https://warthognode.duckdns.org';
    } catch {
      return 'https://warthognode.duckdns.org';
    }
  })();

  const handleValidateAddress = async () => {
    if (!address) {
      setValidateResult({ error: 'Please enter an address' });
      return;
    }
    try {
      const api = await createWarthogApi(selectedNode);
      setValidateResult(await getNodeData(api, `account/${address}/validate`));
    } catch (err) {
      setValidateResult({ error: 'Failed to validate address: ' + err.message });
    }
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
      <p>
        Validate addresses on the Warthog network.
      </p>
      <div className="form-group">
        <label>Address:</label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value.trim())}
          placeholder="Enter 48-character address"
          className="input"
        />
      </div>
      <button
        onClick={handleValidateAddress}
      >
        Validate Address
      </button>
      {validateResult && (
        <div className="result">
          <pre>
            {JSON.stringify(validateResult, null, 2)}
          </pre>
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
