import React, { useState } from 'react';
import axios from 'axios';

const API_URL = '/api/proxy';

const DeFiTestnetPage = ({ selectedNode, wallet }) => {
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});

  const query = async (key, path) => {
    setLoading(prev => ({ ...prev, [key]: true }));
    try {
      const nodeBaseParam = `nodeBase=${encodeURIComponent(selectedNode)}`;
      const response = await axios.get(`${API_URL}?nodePath=${path}&${nodeBaseParam}`);
      setResults(prev => ({ ...prev, [key]: response.data }));
    } catch (err) {
      setResults(prev => ({ ...prev, [key]: { error: err.message } }));
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  const account = wallet?.address || '';

  return (
    <section>
      <h2>DeFi Testnet Tools</h2>
      <p className="mb-6">These endpoints only work on custom/testnet nodes (e.g. http://localhost:3000)</p>

      {/* Asset Endpoints */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-3">Asset Endpoints</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium">Complete (namePrefix / hashPrefix)</label>
            <input id="namePrefix" placeholder="namePrefix" className="input" />
            <input id="hashPrefix" placeholder="hashPrefix (optional)" className="input mt-2" />
            <button onClick={() => {
              const name = document.getElementById('namePrefix').value;
              const hash = document.getElementById('hashPrefix').value;
              let path = `asset/complete?namePrefix=${encodeURIComponent(name)}`;
              if (hash) path += `&hashPrefix=${encodeURIComponent(hash)}`;
              query('assetComplete', path);
            }} disabled={loading.assetComplete}>
              {loading.assetComplete ? 'Querying...' : 'Query'}
            </button>
            {results.assetComplete && <pre className="result">{JSON.stringify(results.assetComplete, null, 2)}</pre>}
          </div>

          <div>
            <label className="block text-sm font-medium">Lookup Asset</label>
            <input id="assetLookup" placeholder="asset identifier" className="input" />
            <button onClick={() => query('assetLookup', `asset/lookup/${encodeURIComponent(document.getElementById('assetLookup').value)}`)} disabled={loading.assetLookup}>
              {loading.assetLookup ? 'Querying...' : 'Query'}
            </button>
            {results.assetLookup && <pre className="result">{JSON.stringify(results.assetLookup, null, 2)}</pre>}
          </div>
        </div>
      </div>

      {/* DEX Endpoints */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-3">DEX Endpoints</h3>
        <div>
          <label className="block text-sm font-medium">Market</label>
          <input id="market" placeholder="market identifier" className="input" />
          <button onClick={() => query('dexMarket', `dex/market/${encodeURIComponent(document.getElementById('market').value)}`)} disabled={loading.dexMarket}>
            {loading.dexMarket ? 'Querying...' : 'Query'}
          </button>
          {results.dexMarket && <pre className="result">{JSON.stringify(results.dexMarket, null, 2)}</pre>}
        </div>
      </div>

      {/* Account Endpoints */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Account Endpoints (uses your wallet address if logged in)</h3>
        <div className="grid grid-cols-1 gap-6">
          <button onClick={() => query('mempool', `account/${account}/mempool`)} disabled={loading.mempool || !account}>
            Mempool
          </button>
          {results.mempool && <pre className="result">{JSON.stringify(results.mempool, null, 2)}</pre>}

          <button onClick={() => query('openOrders', `account/${account}/open_orders`)} disabled={loading.openOrders || !account}>
            Open Orders
          </button>
          {results.openOrders && <pre className="result">{JSON.stringify(results.openOrders, null, 2)}</pre>}

          <div>
            <label>Open Orders for Asset</label>
            <input id="assetForOrders" placeholder="asset identifier" className="input" />
            <button onClick={() => query('openOrdersAsset', `account/${account}/open_orders/${encodeURIComponent(document.getElementById('assetForOrders').value)}`)}>
              Query
            </button>
          </div>

          <button onClick={() => query('wartBalance', `account/${account}/wart_balance`)} disabled={!account}>
            WART Balance
          </button>

          <button onClick={() => query('richlist', `account/richlist/wart`)}>Richlist (WART)</button>

          {/* You can add the other balance/:tokenspec and history/:beforeTxIndex the same way if you need them */}
        </div>
      </div>
    </section>
  );
};

export default DeFiTestnetPage;
