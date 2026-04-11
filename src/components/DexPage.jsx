import React, { useState } from 'react';
import axios from 'axios';

const API_URL = '/api/proxy';

const DexPage = ({ selectedNode, wallet }) => {
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
    <>
      {/* === SECTION 1: Market Data === */}
      <section className="border-2 border-green-500 rounded-3xl p-8 bg-green-50 dark:bg-green-950 shadow-xl mb-10">
        <h2 className="text-2xl font-bold mb-6">DEX Tools</h2>
        <p className="mb-6 text-gray-600 dark:text-gray-400">
          Query decentralized exchange markets and trading data.
        </p>

        <h3 className="text-xl font-semibold mb-4 text-green-700 dark:text-green-300">
          Market Data
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">Market Identifier</label>
            <input id="market" placeholder="market identifier" className="input mb-4" />
            <button
              onClick={() => query('dexMarket', `dex/market/${encodeURIComponent(document.getElementById('market').value)}`)}
              disabled={loading.dexMarket}
              className="px-6 py-3 mx-2 my-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded-2xl transition-colors"
              style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}
            >
              {loading.dexMarket ? 'Querying...' : 'Query Market'}
            </button>
            {results.dexMarket && (
              <pre className="result mt-6">{JSON.stringify(results.dexMarket, null, 2)}</pre>
            )}
          </div>
        </div>
      </section>

      {/* === SECTION 2: Trading Activity === */}
      <section className="border-2 border-orange-500 rounded-3xl p-8 bg-orange-50 dark:bg-orange-950 shadow-xl">
        <h3 className="text-xl font-semibold mb-6 text-orange-700 dark:text-orange-300">
          Trading Activity
        </h3>
        <p className="text-sm text-orange-600 dark:text-orange-400 mb-6">
          Uses your connected wallet address
        </p>

        <div className="space-y-8">
          {/* Open Orders */}
          <div>
            <button
              onClick={() => query('openOrders', `account/${account}/open_orders`)}
              disabled={loading.openOrders || !account}
              className="px-6 py-3 mx-2 my-1 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-2xl transition-colors disabled:bg-gray-400"
              style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}
            >
              {loading.openOrders ? 'Loading...' : 'View All Open Orders'}
            </button>
            {results.openOrders && (
              <pre className="result mt-4">{JSON.stringify(results.openOrders, null, 2)}</pre>
            )}
          </div>

          {/* Open Orders for Specific Asset */}
          <div>
            <label className="block text-sm font-medium mb-2">Open Orders for Specific Asset</label>
            <input id="assetForOrders" placeholder="asset identifier" className="input mb-3" />
            <button
              onClick={() => query('openOrdersAsset', `account/${account}/open_orders/${encodeURIComponent(document.getElementById('assetForOrders').value)}`)}
              disabled={!account}
              className="px-6 py-3 mx-2 my-1 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-2xl transition-colors disabled:bg-gray-400"
              style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}
            >
              Query Asset Orders
            </button>
          </div>

          {/* Mempool */}
          <div>
            <button
              onClick={() => query('mempool', `account/${account}/mempool`)}
              disabled={loading.mempool || !account}
              className="px-6 py-3 mx-2 my-1 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-2xl transition-colors disabled:bg-gray-400"
              style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}
            >
              {loading.mempool ? 'Loading...' : 'View Mempool'}
            </button>
            {results.mempool && (
              <pre className="result mt-4">{JSON.stringify(results.mempool, null, 2)}</pre>
            )}
          </div>
        </div>
      </section>
    </>
  );
};

export default DexPage;
