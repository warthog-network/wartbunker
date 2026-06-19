import React, { useState, useEffect } from 'react';
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
  const [selectedNode, setSelectedNode] = useState(DEFAULT_NODE_URL);
  const [customNode, setCustomNode] = useState('');

  useEffect(() => {
    const savedNode = localStorage.getItem('selectedNode') || DEFAULT_NODE_URL;
    setSelectedNode(savedNode);
  }, []);

  const handleNodeChange = (e) => {
    const newNode = e.target.value;
    setSelectedNode(newNode);
    localStorage.setItem('selectedNode', newNode);
    if (onNodeChange) onNodeChange(newNode);
  };

  const useTestnet = () => {
    setSelectedNode(DEFI_TESTNET_URL);
    setCustomNode(DEFI_TESTNET_URL);
    localStorage.setItem('selectedNode', DEFI_TESTNET_URL);
    if (onNodeChange) onNodeChange(DEFI_TESTNET_URL);
  };

  const saveCustomNode = () => {
    const normalized = normalizeNodeUrl(customNode);
    if (normalized) {
      setSelectedNode(normalized);
      setCustomNode(normalized);
      localStorage.setItem('selectedNode', normalized);
      if (onNodeChange) onNodeChange(normalized);
    }
  };

  const showDefiActive = isDefiNode(selectedNode);

  return (
    <section>
      <h2>Node Selection</h2>
      <p>Select a DeFi testnet node to connect to.</p>

      <div className="form-group">
        <label>Select Preset Node:</label>
        <select value={selectedNode} onChange={handleNodeChange} className="input">
          {PRESET_NODES.map(({ url, name }) => (
            <option key={url} value={url}>{name} — {url}</option>
          ))}
          <option value={selectedNode} disabled={isPresetNodeUrl(selectedNode)}>
            {selectedNode} (custom)
          </option>
        </select>
      </div>

      <div className="form-group">
        <label>Or enter Custom Node URL:</label>
        <input
          type="text"
          value={customNode}
          onChange={(e) => setCustomNode(e.target.value)}
          placeholder="http://127.0.0.1:3001 or https://warthog-defitestnet.duckdns.org"
          className="input"
        />
        <button 
          onClick={saveCustomNode} 
          className="mt-3 w-full py-2.5 text-sm font-medium bg-zinc-800 hover:bg-zinc-700 rounded-2xl border border-zinc-700"
        >
          Save Custom Node
        </button>
      </div>

      <button
        onClick={useTestnet}
        className="mt-2 w-full py-2.5 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 rounded-2xl transition-colors"
      >
        Use DeFi Testnet (warthog-defitestnet.duckdns.org)
      </button>

      <div className="result">
        <p><strong>Current Node:</strong> {selectedNode}</p>
        {isLoopbackNode(selectedNode) && !shouldUseNodeProxy(selectedNode) && (
          <p className="text-amber-400 text-sm mt-2">
            Loopback node: your browser connects directly. The node must allow CORS from this site.
          </p>
        )}
        {isLocalNode(selectedNode) && !isLoopbackNode(selectedNode) && (
          <p className="text-amber-400 text-sm mt-2">
            LAN node: requests go through this site&apos;s server proxy (works when the wallet host can reach that IP).
          </p>
        )}
        {shouldUseNodeProxy(selectedNode) && selectedNode.startsWith('http://') && (
          <p className="text-amber-400 text-sm mt-2">
            HTTP node: requests go through this site&apos;s server proxy (required on HTTPS). Use the full URL, e.g.
            {' '}http://65.87.7.86:3002 — not https:// on an HTTP-only port.
          </p>
        )}
        {showDefiActive && <p className="text-emerald-600">DeFi testnet active — Assets, DEX, and testnet balance enabled</p>}
      </div>
    </section>
  );
};

export default NodeSelectionPage;