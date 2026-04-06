import React, { useState } from 'react';
import axios from 'axios';

const API_URL = '/api/proxy';

const AssetPage = ({ selectedNode, wallet }) => {
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});

  const query = async (key, path, method = 'GET', data = null) => {
    setLoading(prev => ({ ...prev, [key]: true }));
    try {
      const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;
      const config = {
        method,
        url: `${API_URL}?nodePath=${path}&${nodeBaseParam}`,
      };
      if (data) {
        config.data = data;
        config.headers = { 'Content-Type': 'application/json' };
      }
      const response = await axios(config);
      setResults(prev => ({ ...prev, [key]: response.data }));
    } catch (err) {
      setResults(prev => ({ ...prev, [key]: { error: err.message } }));
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  return (
    <div>
      <section>
      <h2>Asset Tools</h2>
      <p className="mb-6 text-gray-600 dark:text-gray-400">
        Create, transfer, search, and look up assets on the DeFi testnet.
      </p>

      {/* CREATE ASSET CARD */}
      <div className="border-2 border-green-500 rounded-3xl p-8 bg-green-50 dark:bg-green-950 shadow-xl">
        <h3 className="text-2xl font-bold mb-6 text-green-700 dark:text-green-300 flex items-center gap-3">
          🪙 Create Asset
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">Asset Name</label>
            <input id="assetName" placeholder="asset name" className="input mb-3" />

            <label className="block text-sm font-medium mb-2">Supply</label>
            <input id="assetSupply" type="number" placeholder="total supply" className="input mb-3" />

            <label className="block text-sm font-medium mb-2">Decimals</label>
            <input id="assetDecimals" type="number" placeholder="decimals" className="input mb-6" defaultValue="8" />

            <button
              onClick={() => {
                const name = document.getElementById('assetName').value;
                const supply = document.getElementById('assetSupply').value;
                const decimals = document.getElementById('assetDecimals').value;
                const data = { name, supply: parseInt(supply), decimals: parseInt(decimals) };
                query('createAsset', 'asset/create', 'POST', data);
              }}
              disabled={loading.createAsset || !wallet?.address}
              className="px-6 py-3 mx-2 my-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded-2xl transition-colors"
            style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}
            >
              {loading.createAsset ? 'Creating...' : 'Create Asset'}
            </button>

            {results.createAsset && <pre className="result mt-6">{JSON.stringify(results.createAsset, null, 2)}</pre>}
          </div>
        </div>
      </div>
</section>
<section>
      {/* TRANSFER ASSET CARD */}
      <div className="border-2 border-red-500 rounded-3xl p-8 bg-red-50 dark:bg-red-950 shadow-xl">
        <h3 className="text-2xl font-bold mb-6 text-red-700 dark:text-red-300 flex items-center gap-3">
          🔄 Transfer Asset
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">Asset ID</label>
            <input id="transferAssetId" placeholder="asset identifier" className="input mb-3" />

            <label className="block text-sm font-medium mb-2">Recipient Address</label>
            <input id="transferRecipient" placeholder="recipient address" className="input mb-3" />

            <label className="block text-sm font-medium mb-2">Amount</label>
            <input id="transferAmount" type="number" placeholder="amount to transfer" className="input mb-6" />

            <button
              onClick={() => {
                const assetId = document.getElementById('transferAssetId').value;
                const recipient = document.getElementById('transferRecipient').value;
                const amount = document.getElementById('transferAmount').value;
                const data = { assetId, recipient, amount: parseFloat(amount) };
                query('transferAsset', 'asset/transfer', 'POST', data);
              }}
              disabled={loading.transferAsset || !wallet?.address}
              className="px-6 py-3 mx-2 my-1 bg-red-600 hover:bg-red-700 text-white font-medium rounded-2xl transition-colors"
            style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}
            >
              {loading.transferAsset ? 'Transferring...' : 'Transfer Asset'}
            </button>

            {results.transferAsset && <pre className="result mt-6">{JSON.stringify(results.transferAsset, null, 2)}</pre>}
          </div>
        </div>
      </div>
</section>
      <section>
      {/* SEARCH & LOOKUP CARD */}
     
      <div className="border-2 border-blue-500 rounded-3xl p-8 bg-blue-50 dark:bg-blue-950 shadow-xl">
        
        <h3 className="text-2xl font-bold mb-6 text-blue-700 dark:text-blue-300 flex items-center gap-3">
          🔍 Asset Search & Lookup
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
     
          <div>
            <label className="block text-sm font-medium mb-2">Asset Complete</label>
            <input id="namePrefix" placeholder="namePrefix" className="input mb-3" />
            <input id="hashPrefix" placeholder="hashPrefix (optional)" className="input mb-4" />
            <button
              onClick={() => {
                const name = document.getElementById('namePrefix').value;
                const hash = document.getElementById('hashPrefix').value;
                let path = `asset/complete?namePrefix=${encodeURIComponent(name)}`;
                if (hash) path += `&hashPrefix=${encodeURIComponent(hash)}`;
                query('assetComplete', path);
              }}
              disabled={loading.assetComplete}
              className="px-6 py-3 mx-2 my-1 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-2xl transition-colors"
            style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}
            >
              {loading.assetComplete ? 'Querying...' : 'Query'}
            </button>
            {results.assetComplete && <pre className="result mt-6">{JSON.stringify(results.assetComplete, null, 2)}</pre>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Lookup Asset</label>
            <input id="assetLookup" placeholder="asset identifier" className="input mb-4" />
            <button
              onClick={() => query('assetLookup', `asset/lookup/${encodeURIComponent(document.getElementById('assetLookup').value)}`)}
              disabled={loading.assetLookup}
              className="px-6 py-3 mx-2 my-1 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-2xl transition-colors"
            style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}
            >
              {loading.assetLookup ? 'Querying...' : 'Query'}
            </button>
            {results.assetLookup && <pre className="result mt-6">{JSON.stringify(results.assetLookup, null, 2)}</pre>}
          </div>
        </div>
      </div>
      </section>
    </div>
  );
};

export default AssetPage;
