import React, { useState } from 'react';
import { useToast } from './Toast';
import { createWarthogApi, getNodeData } from '../utils/warthogClient.js';
import {
  CHART_API_UNSUPPORTED_CODE,
  CHART_INTERVALS,
  buildCandlesPath,
  buildPriceHistoryFromLatest,
  buildTradesPath,
  formatAssetPrice,
  normalizeChartAssetHash,
  parseCandleResponse,
  parseTradeResponse,
} from '../utils/dexPrice.js';
import AssetPriceChart from './AssetPriceChart.jsx';
import { DEFAULT_NODE_URL } from '../utils/presetNodes.js';

const DexPriceChartsTool = ({ selectedNode: propSelectedNode }) => {
  const selectedNode = propSelectedNode || (() => {
    try {
      return localStorage.getItem('selectedNode') || DEFAULT_NODE_URL;
    } catch {
      return DEFAULT_NODE_URL;
    }
  })();

  const toast = useToast();
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});
  const [chartMode, setChartMode] = useState('candles');
  const [chartInterval, setChartInterval] = useState('1h');
  const [chartAssetName, setChartAssetName] = useState('Asset');
  const [chartFallbackNote, setChartFallbackNote] = useState(null);

  const loadPriceChart = async () => {
    const assetRaw = document.getElementById('chartAssetHash')?.value.trim() || '';
    const assetHash = normalizeChartAssetHash(assetRaw);
    if (!assetHash) {
      toast.error('Asset Hash must be exactly 64 hex characters');
      return;
    }

    const countRaw = document.getElementById('chartCount')?.value.trim() || '200';
    const n = Math.min(500, Math.max(10, parseInt(countRaw, 10) || 200));

    const chartKey = chartMode === 'candles' ? 'priceCandles' : 'priceTrades';
    setLoading((prev) => ({ ...prev, [chartKey]: true }));
    setChartFallbackNote(null);

    try {
      const path = chartMode === 'candles'
        ? buildCandlesPath(assetHash, chartInterval, { n })
        : buildTradesPath(assetHash, { n });

      const api = await createWarthogApi(selectedNode);
      const result = await getNodeData(api, path);

      let points = [];
      let usedFallback = false;

      if (result.code === 0) {
        points = chartMode === 'candles'
          ? parseCandleResponse(result.data)
          : parseTradeResponse(result.data);
      } else if (result.code === CHART_API_UNSUPPORTED_CODE) {
        const latestRes = await getNodeData(api, 'transaction/latest');
        if (latestRes.code !== 0) {
          setResults((prev) => ({
            ...prev,
            [chartKey]: {
              error: 'Chart API is not enabled on this node and recent trades could not be loaded.',
            },
          }));
          return;
        }

        points = buildPriceHistoryFromLatest(latestRes.data, assetHash, {
          mode: chartMode,
          interval: chartInterval,
          n,
        });
        usedFallback = true;

        if (!points.length) {
          setResults((prev) => ({
            ...prev,
            [chartKey]: {
              error: 'Chart API is not enabled on this node yet. No recent DEX matches were found for this asset in the latest blocks.',
            },
          }));
          return;
        }
      } else {
        setResults((prev) => ({
          ...prev,
          [chartKey]: { error: result.error || 'Node returned an error' },
        }));
        return;
      }

      setResults((prev) => ({ ...prev, [chartKey]: { code: 0, data: points } }));
      if (usedFallback) {
        setChartFallbackNote(
          'Chart API unavailable on this node — showing DEX match trades from recent blocks (/transaction/latest).',
        );
      }

      const marketRes = await getNodeData(api, `dex/market/${assetHash}`);
      if (marketRes.code === 0) {
        const name = marketRes.data?.baseAsset?.name;
        if (name) setChartAssetName(name);
      }
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [chartKey]: { error: err.message || 'Failed to load chart data' },
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [chartKey]: false }));
    }
  };

  const chartKey = chartMode === 'candles' ? 'priceCandles' : 'priceTrades';
  const chartResult = results[chartKey];
  const chartLoading = loading[chartKey];
  const chartError = chartResult?.error
    || (chartResult && chartResult.code !== 0 ? chartResult.error : null);
  const chartPoints = chartResult?.code === 0 ? chartResult.data : [];
  const intervalLabel = CHART_INTERVALS.find((i) => i.id === chartInterval)?.label || chartInterval;

  return (
    <section className="border-2 border-violet-500 rounded-3xl p-8 bg-violet-50 dark:bg-violet-950 shadow-xl">
      <h3 className="text-xl font-semibold mb-2 text-violet-700 dark:text-violet-300">
        Asset Price History
      </h3>
      <p className="text-sm text-violet-600 dark:text-violet-400 mb-6">
        Uses <code className="text-violet-300">/chart/candles/:asset/:interval</code> and{' '}
        <code className="text-violet-300">/chart/trades/:asset</code> when the node supports them;
        otherwise builds history from recent DEX matches in <code className="text-violet-300">/transaction/latest</code>.
        Prices are WART per asset token.
      </p>

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Asset Hash (64 hex chars)</label>
            <input
              id="chartAssetHash"
              placeholder="e.g. 0e4825efffa294610d2ac376713e3bcc9b53d378e823834b64e5df01f75d3b0c"
              className="input font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Data points (n)</label>
            <input id="chartCount" type="number" min="10" max="500" defaultValue="200" className="input" />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Chart type</label>
            <div className="flex gap-1 p-1 bg-zinc-900 border border-zinc-700 rounded-xl">
              <button
                type="button"
                onClick={() => setChartMode('candles')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${chartMode === 'candles' ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white'}`}
              >
                Candles
              </button>
              <button
                type="button"
                onClick={() => setChartMode('trades')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${chartMode === 'trades' ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white'}`}
              >
                Trades
              </button>
            </div>
          </div>

          {chartMode === 'candles' && (
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Interval</label>
              <select
                value={chartInterval}
                onChange={(e) => setChartInterval(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 text-white px-4 py-2.5 rounded-xl outline-none focus:border-violet-500"
              >
                {CHART_INTERVALS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={loadPriceChart}
            disabled={chartLoading}
            className="px-8 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-2xl transition-all disabled:bg-gray-400"
          >
            {chartLoading ? 'Loading…' : 'Load Price Chart'}
          </button>
        </div>

        {chartFallbackNote && (
          <div className="p-3 bg-amber-950/40 border border-amber-700/60 rounded-xl text-xs text-amber-200">
            {chartFallbackNote}
          </div>
        )}

        <AssetPriceChart
          points={chartPoints}
          mode={chartMode}
          assetName={chartAssetName}
          intervalLabel={chartMode === 'candles' ? intervalLabel : 'Recent trades'}
          loading={chartLoading}
          error={chartError}
        />

        {chartMode === 'trades' && chartPoints?.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-sm text-violet-400 hover:text-violet-300 flex items-center gap-2 select-none">
              <span className="group-open:rotate-90 inline-block transition">▶</span>
              Recent trades table ({Math.min(chartPoints.length, 20)} shown)
            </summary>
            <div className="mt-2 overflow-x-auto rounded-xl border border-zinc-700">
              <table className="w-full text-xs font-mono">
                <thead className="bg-zinc-900 text-zinc-400">
                  <tr>
                    <th className="text-left px-3 py-2">Time</th>
                    <th className="text-right px-3 py-2">Block</th>
                    <th className="text-right px-3 py-2">Base</th>
                    <th className="text-right px-3 py-2">Quote (WART)</th>
                    <th className="text-right px-3 py-2">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {[...chartPoints].reverse().slice(0, 20).map((t, idx) => (
                    <tr key={idx} className="border-t border-zinc-800 text-zinc-300">
                      <td className="px-3 py-1.5">
                        {new Date(t.timestamp * 1000).toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-right">{t.height}</td>
                      <td className="px-3 py-1.5 text-right">{formatAssetPrice(t.base, 4)}</td>
                      <td className="px-3 py-1.5 text-right">{formatAssetPrice(t.quote, 4)}</td>
                      <td className="px-3 py-1.5 text-right text-emerald-400">
                        {formatAssetPrice(t.price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </section>
  );
};

export default DexPriceChartsTool;