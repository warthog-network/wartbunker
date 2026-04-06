import React, { useState } from 'react';
import axios from 'axios';

const API_URL = '/api/proxy';

const ToolsPage = ({ selectedNode: propSelectedNode }) => {
  const [address, setAddress] = useState('');
  const [validateResult, setValidateResult] = useState(null);
  const selectedNode = propSelectedNode || localStorage.getItem('selectedNode') || 'https://warthognode.duckdns.org';

  const handleValidateAddress = async () => {
    if (!address) {
      setValidateResult({ error: 'Please enter an address' });
      return;
    }
    try {
      const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;
      const response = await axios.get(`${API_URL}?nodePath=account/${address}/validate&${nodeBaseParam}`, {
        headers: { 'Cache-Control': 'no-cache' }
      });
      setValidateResult(response.data);
    } catch (err) {
      setValidateResult({ error: 'Failed to validate address: ' + err.message });
    }
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
    </section>
  );
};

export default ToolsPage;
