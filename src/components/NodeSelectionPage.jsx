import React, { useState, useEffect } from 'react';
import { isLocalNode } from '../utils/nodeAccess';
import { normalizeNodeUrl } from '../utils/warthogClient.js';

const defaultNodeList = [
  'https://warthognode.duckdns.org',
  'http://217.182.64.43:3001',
  'https://warthog-defitestnet.duckdns.org',
];

const NodeSelectionPage = ({ onNodeChange }) => {
  const [selectedNode, setSelectedNode] = useState(defaultNodeList[0]);
  const [customNode, setCustomNode] = useState('');

  useEffect(() => {
    const savedNode = localStorage.getItem('selectedNode') || defaultNodeList[0];
    setSelectedNode(savedNode);
  }, []);

  const handleNodeChange = (e) => {
    const newNode = e.target.value;
    setSelectedNode(newNode);
    localStorage.setItem('selectedNode', newNode);
    if (onNodeChange) onNodeChange(newNode);
  };

  const useTestnet = () => {
    const testnetUrl = 'https://warthog-defitestnet.duckdns.org';
    setSelectedNode(testnetUrl);
    setCustomNode(testnetUrl);
    localStorage.setItem('selectedNode', testnetUrl);
    if (onNodeChange) onNodeChange(testnetUrl);
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

  const isTestnetOrCustom = !defaultNodeList.includes(selectedNode) || selectedNode.toLowerCase().includes('defitestnet');

  return (
    <section>
      <h2>Node Selection</h2>
      <p>Select the Warthog network node to connect to.</p>

      <div className="form-group">
        <label>Select Preset Node:</label>
        <select value={selectedNode} onChange={handleNodeChange} className="input">
          {defaultNodeList.map((node, index) => (
            <option key={index} value={node}>{node}</option>
          ))}
          <option value={selectedNode} disabled={!defaultNodeList.includes(selectedNode)}>
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
        {isLocalNode(selectedNode) && (
          <p className="text-amber-400 text-sm mt-2">
            Local/LAN node: your browser connects directly. The node must allow CORS from this site.
          </p>
        )}
        {!isLocalNode(selectedNode) && selectedNode.startsWith('http://') && (
          <p className="text-amber-400 text-sm mt-2">
            HTTP node: requests go through this site&apos;s server proxy (required on HTTPS). HTTPS nodes (like the
            testnet) work the same way but are often easier to expose publicly.
          </p>
        )}
        {isTestnetOrCustom && <p className="text-emerald-600">Testnet / Custom node active — DeFi tools enabled</p>}
      </div>
    </section>
  );
};

export default NodeSelectionPage;
