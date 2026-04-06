import React, { useState, useEffect } from 'react';

const defaultNodeList = [
  'https://warthognode.duckdns.org',
  'http://217.182.64.43:3001',
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
    const testnetUrl = 'http://localhost:3000';
    setSelectedNode(testnetUrl);
    setCustomNode(testnetUrl);
    localStorage.setItem('selectedNode', testnetUrl);
    if (onNodeChange) onNodeChange(testnetUrl);
  };

  const saveCustomNode = () => {
    if (customNode) {
      setSelectedNode(customNode);
      localStorage.setItem('selectedNode', customNode);
      if (onNodeChange) onNodeChange(customNode);
    }
  };

  const isCustomSelected = !defaultNodeList.includes(selectedNode);

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
          placeholder="http://localhost:3000"
          className="input"
        />
        <button onClick={saveCustomNode} className="mt-2">Save Custom Node</button>
      </div>

      <button
        onClick={useTestnet}
        className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
      >
        Use DeFi Testnet (localhost:3000)
      </button>

      <div className="result">
        <p><strong>Current Node:</strong> {selectedNode}</p>
        {isCustomSelected && <p className="text-emerald-600">✅ Testnet / Custom node active → DeFi tools enabled</p>}
      </div>
    </section>
  );
};

export default NodeSelectionPage;
