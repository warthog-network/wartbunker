import React, { useState, useEffect } from 'react';
import { useWallet } from './WalletContext';
import { isLocalNode, isLoopbackNode, shouldUseNodeProxy } from '../utils/nodeAccess';
import { normalizeNodeUrl } from '../utils/warthogClient.js';
import {
  PRESET_NODES,
  DEFAULT_NODE_URL,
  DEFI_TESTNET_URL,
  isPresetNodeUrl,
  isDefiNode,
} from '../utils/presetNodes.js';

const NodeSelectionPage = ({ onNodeChange }) => {
  const {
    pinHeight,
    pinHash,
    balance,
    refreshBalance,
  } = useWallet();

  const [selectedNode, setSelectedNode] = useState(DEFAULT_NODE_URL);
  const [customNode, setCustomNode] = useState('');

  useEffect(() => {
    const savedNode = localStorage.getItem('selectedNode') || DEFAULT_NODE_URL;
    setSelectedNode(savedNode);
    setCustomNode(savedNode);
  }, []);

  const applyNode = (newNode) => {
    setSelectedNode(newNode);
    localStorage.setItem('selectedNode', newNode);
    if (onNodeChange) onNodeChange(newNode);
  };

  const handleNodeChange = (e) => {
    applyNode(e.target.value);
  };

  const useTestnet = () => {
    setCustomNode(DEFI_TESTNET_URL);
    applyNode(DEFI_TESTNET_URL);
  };

  const saveCustomNode = () => {
    const normalized = normalizeNodeUrl(customNode);
    if (normalized) {
      setCustomNode(normalized);
      applyNode(normalized);
    }
  };

  const showDefiActive = isDefiNode(selectedNode);
  const isConnected = balance !== null;

  return (
    <section className="!p-0 !bg-transparent !border-0 !shadow-none !mb-0">
      <div className="mb-5">
        <h2 className="!mb-1">Network</h2>
        <p className="text-xs text-zinc-500">Connection status and node configuration</p>
      </div>

      <div className="space-y-4">
        {/* Live status */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-medium">
              Network Status
            </div>
            <button
              type="button"
              onClick={refreshBalance}
              className="refresh-balance-btn flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-zinc-400 bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-600/50 rounded-lg transition-colors !m-0"
              title="Refresh connection"
            >
              <span className="text-[#FDB913] text-[11px] leading-none">⟳</span>
              Refresh
            </button>
          </div>

          <div className="flex items-center gap-2 mb-3 text-xs">
            <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${isConnected ? 'bg-emerald-400' : 'bg-zinc-600 animate-pulse'}`} />
            <span className={isConnected ? 'text-emerald-400' : 'text-zinc-500'}>
              {isConnected ? 'Connected' : 'Connecting…'}
            </span>
            {showDefiActive && (
              <span className="text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/20">
                DeFi testnet
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-800">
              <div className="text-[10px] text-zinc-500 mb-1">Node</div>
              <div className="text-xs font-mono text-zinc-300 break-all leading-snug">{selectedNode}</div>
            </div>
            <div className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-800">
              <div className="text-[10px] text-zinc-500 mb-1">Pin Height</div>
              <div className="text-sm font-mono text-white tabular-nums">{pinHeight ?? '—'}</div>
            </div>
            <div className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-800">
              <div className="text-[10px] text-zinc-500 mb-1">Pin Hash</div>
              <div className="text-xs font-mono text-zinc-300 break-all leading-snug">{pinHash ?? '—'}</div>
            </div>
          </div>
        </div>

        {/* Node selection */}
        <div className="bg-zinc-950 border border-zinc-700 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-zinc-900/80 border-b border-zinc-700">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Change Node
            </span>
          </div>

          <div className="p-4 space-y-4">
            <div className="form-group !mb-0">
              <label>Preset Node</label>
              <select value={selectedNode} onChange={handleNodeChange} className="input">
                {PRESET_NODES.map(({ url, name }) => (
                  <option key={url} value={url}>{name} — {url}</option>
                ))}
                <option value={selectedNode} disabled={isPresetNodeUrl(selectedNode)}>
                  {selectedNode} (custom)
                </option>
              </select>
            </div>

            <div className="form-group !mb-0">
              <label>Custom Node URL</label>
              <input
                type="text"
                value={customNode}
                onChange={(e) => setCustomNode(e.target.value)}
                placeholder="http://127.0.0.1:3001 or https://warthog-defitestnet.duckdns.org"
                className="input font-mono text-sm"
              />
              <div className="mt-3 flex flex-col items-start gap-3">
                <button
                  type="button"
                  onClick={saveCustomNode}
                  className="network-node-btn network-node-btn--secondary"
                >
                  Save Custom Node
                </button>
                <button
                  type="button"
                  onClick={useTestnet}
                  className="wallet-action-btn !m-0 py-3 px-5 font-semibold whitespace-nowrap"
                >
                  Use DeFi Testnet
                </button>
              </div>
            </div>

            {(isLoopbackNode(selectedNode) && !shouldUseNodeProxy(selectedNode)) && (
              <p className="text-amber-400/90 text-xs leading-relaxed">
                Loopback node: your browser connects directly. The node must allow CORS from this site.
              </p>
            )}
            {isLocalNode(selectedNode) && !isLoopbackNode(selectedNode) && (
              <p className="text-amber-400/90 text-xs leading-relaxed">
                LAN node: requests go through this site&apos;s server proxy.
              </p>
            )}
            {shouldUseNodeProxy(selectedNode) && selectedNode.startsWith('http://') && (
              <p className="text-amber-400/90 text-xs leading-relaxed">
                HTTP node: requests go through this site&apos;s server proxy (required on HTTPS).
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default NodeSelectionPage;