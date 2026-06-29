import React, { useId, useMemo, useState } from 'react';
import {
  computeChartPriceStats,
  formatChartChangePercent,
  formatChartDataSpan,
  toChartSeries,
} from '../utils/dexPrice.js';
import FormattedNumber from './FormattedNumber.jsx';
import { useNumberDisplay } from './NumberDisplayContext.jsx';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 280;
const PAD = { top: 20, right: 16, bottom: 36, left: 72 };

function buildPath(points, xScale, yScale) {
  if (!points.length) return '';
  if (points.length === 1) {
    const x = xScale(points[0].x);
    const y = yScale(points[0].y);
    const x2 = Math.min(x + 24, CHART_WIDTH - PAD.right);
    return `M${x.toFixed(2)},${y.toFixed(2)} L${x2.toFixed(2)},${y.toFixed(2)}`;
  }
  return points
    .map((pt, i) => {
      const cmd = i === 0 ? 'M' : 'L';
      return `${cmd}${xScale(pt.x).toFixed(2)},${yScale(pt.y).toFixed(2)}`;
    })
    .join(' ');
}

function buildAreaPath(points, xScale, yScale, baselineY) {
  if (!points.length) return '';
  const line = buildPath(points, xScale, yScale);
  const firstX = xScale(points[0].x).toFixed(2);
  const lastX = xScale(points[points.length - 1].x).toFixed(2);
  return `${line} L${lastX},${baselineY} L${firstX},${baselineY} Z`;
}

const AssetPriceChart = ({
  points = [],
  mode = 'candles',
  assetName = 'Asset',
  intervalLabel = '',
  loading = false,
  error = null,
  embedded = false,
  tradePrice = null,
  poolSpot = null,
  candleInterval = '1h',
}) => {
  const { formatNumber } = useNumberDisplay();
  const [hoverIdx, setHoverIdx] = useState(null);
  const areaGradientId = useId();
  const shellClass = embedded
    ? ''
    : 'mt-4 bg-zinc-950 border border-zinc-700 rounded-2xl overflow-hidden';

  const series = useMemo(() => toChartSeries(points, mode), [points, mode]);

  const stats = useMemo(() => computeChartPriceStats(series), [series]);
  const dataSpan = useMemo(
    () => (mode === 'candles' ? formatChartDataSpan(series, { mode, candleInterval }) : null),
    [series, mode, candleInterval],
  );

  const plot = useMemo(() => {
    const innerW = CHART_WIDTH - PAD.left - PAD.right;
    const innerH = CHART_HEIGHT - PAD.top - PAD.bottom;

    if (!series.length) {
      return { series, xScale: () => 0, yScale: () => 0, innerW, innerH, yTicks: [], xTicks: [] };
    }

    const xMin = series[0].x;
    const xMax = series[series.length - 1].x;
    const yMin = Math.min(...series.map((p) => p.y));
    const yMax = Math.max(...series.map((p) => p.y));
    const yPad = (yMax - yMin) * 0.08 || yMax * 0.05 || 0.0001;
    const yLo = Math.max(0, yMin - yPad);
    const yHi = yMax + yPad;

    const xScale = (x) => {
      if (xMax === xMin) return PAD.left + innerW / 2;
      return PAD.left + ((x - xMin) / (xMax - xMin)) * innerW;
    };
    const yScale = (y) => PAD.top + innerH - ((y - yLo) / (yHi - yLo)) * innerH;

    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const t = i / 4;
      const val = yLo + (yHi - yLo) * (1 - t);
      return { val, y: yScale(val) };
    });

    const xTickCount = Math.min(5, series.length);
    const xTicks = Array.from({ length: xTickCount }, (_, i) => {
      const idx = xTickCount === 1 ? 0 : Math.round((i / (xTickCount - 1)) * (series.length - 1));
      const pt = series[idx];
      return { label: pt.label, x: xScale(pt.x) };
    });

    return { series, xScale, yScale, innerW, innerH, yTicks, xTicks, yLo, yHi, baselineY: yScale(yLo) };
  }, [series]);

  if (loading) {
    return (
      <div className={embedded ? 'p-8 text-center text-sm text-zinc-500' : `${shellClass} p-10 text-center text-zinc-400`}>
        Loading price history…
      </div>
    );
  }

  if (error) {
    return (
      <div className={embedded ? 'p-4 text-sm text-red-400' : `${shellClass} p-6 bg-red-950/40 border-red-900 text-sm text-red-400`}>
        {error}
      </div>
    );
  }

  if (!series.length) {
    return (
      <div className={embedded ? 'p-8 text-center' : `${shellClass} p-10 text-center`}>
        <div className="text-2xl mb-2 opacity-30">📈</div>
        <p className="text-zinc-400 font-medium text-sm">No price history for this asset</p>
        <p className="text-xs text-zinc-500 mt-1">Try a different interval or check that the pool has trades.</p>
      </div>
    );
  }

  const linePath = buildPath(plot.series, plot.xScale, plot.yScale);
  const areaPath = buildAreaPath(plot.series, plot.xScale, plot.yScale, plot.baselineY);
  const hoverPt = hoverIdx != null ? plot.series[hoverIdx] : null;
  const changeDisplay = formatChartChangePercent(stats?.change);
  const changeUp = stats?.change != null && stats.change >= 0;
  const changeNeutral = stats?.change == null;

  return (
    <div className={shellClass || undefined}>
      <div className={`${embedded ? 'px-4 py-3' : 'px-5 py-4'} border-b border-zinc-800 flex flex-wrap items-end justify-between gap-3`}>
        <div>
          <div className="text-xs uppercase tracking-[0.12em] text-purple-400 mb-0.5">
            {mode === 'candles' ? 'OHLC Close' : 'Trade Price'} • {intervalLabel || 'History'}
          </div>
          <div className={`font-semibold ${embedded ? 'text-xl' : 'text-2xl'}`}>
            <FormattedNumber value={stats?.last} className="font-semibold" />
            <span className="text-sm text-zinc-500 font-normal ml-2 font-sans">WART/{assetName}</span>
          </div>
          {mode === 'trades' && (
            <div className="text-[10px] text-zinc-500 mt-0.5">
              Each point is a matched swap (limit orders only count after they fill)
            </div>
          )}
          {embedded && mode === 'candles' && (tradePrice != null || poolSpot != null) && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs font-mono">
              {tradePrice != null && Number.isFinite(tradePrice) && (
                <span className="text-zinc-500">
                  Last trade{' '}
                  <FormattedNumber value={tradePrice} />
                  <span className="text-zinc-600 ml-1">WART/{assetName}</span>
                </span>
              )}
              {poolSpot != null && Number.isFinite(poolSpot) && (
                <span className="text-zinc-500">
                  Pool spot{' '}
                  <FormattedNumber value={poolSpot} />
                  <span className="text-zinc-600 ml-1">WART/{assetName}</span>
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-4 text-xs font-mono">
          <div>
            <span className="text-zinc-500">Low </span>
            <FormattedNumber value={stats?.min} />
          </div>
          <div>
            <span className="text-zinc-500">High </span>
            <FormattedNumber value={stats?.max} />
          </div>
          <div>
            <span className="text-zinc-500">{stats?.changeLabel ?? 'Δ 24h'} </span>
            <span
              className={
                changeNeutral
                  ? 'text-zinc-500'
                  : changeUp
                    ? 'text-[#FDB913]'
                    : 'text-rose-400'
              }
              title={
                stats?.changeWindow === 'since_first'
                  ? 'History spans less than 24h — change from earliest point shown'
                  : stats?.changeWindow === 'unavailable'
                    ? 'Not enough history to compute change'
                    : 'Change vs price at or before 24 hours ago'
              }
            >
              {changeDisplay}
            </span>
          </div>
        </div>
      </div>

      <div className={embedded ? 'p-3' : 'p-4'}>
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="w-full h-auto select-none"
          role="img"
          aria-label={`Price chart for ${assetName}`}
        >
          <defs>
            <linearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FDB913" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#FDB913" stopOpacity="0" />
            </linearGradient>
          </defs>

          {plot.yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={PAD.left}
                y1={tick.y}
                x2={CHART_WIDTH - PAD.right}
                y2={tick.y}
                stroke="rgb(63, 63, 70)"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
              <text
                x={PAD.left - 8}
                y={tick.y + 4}
                textAnchor="end"
                fill="rgb(161, 161, 170)"
                fontSize="10"
                fontFamily="ui-monospace, monospace"
              >
                {formatNumber(tick.val, { maxDecimals: 6 })}
              </text>
            </g>
          ))}

          <path d={areaPath} fill={`url(#${areaGradientId})`} />
          <path
            d={linePath}
            fill="none"
            stroke="#FDB913"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {plot.series.map((pt, idx) => (
            <circle
              key={idx}
              cx={plot.xScale(pt.x)}
              cy={plot.yScale(pt.y)}
              r={hoverIdx === idx ? 5 : 3}
              fill={hoverIdx === idx ? '#FDB913' : '#E79300'}
              stroke="#231F20"
              strokeWidth="1"
              className="cursor-pointer"
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
            />
          ))}

          {hoverPt && (
            <g>
              <line
                x1={plot.xScale(hoverPt.x)}
                y1={PAD.top}
                x2={plot.xScale(hoverPt.x)}
                y2={CHART_HEIGHT - PAD.bottom}
                stroke="#c084fc"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            </g>
          )}

          {plot.xTicks.map((tick, i) => (
            <text
              key={i}
              x={tick.x}
              y={CHART_HEIGHT - 10}
              textAnchor="middle"
              fill="rgb(113, 113, 122)"
              fontSize="9"
              fontFamily="ui-monospace, monospace"
            >
              {tick.label}
            </text>
          ))}
        </svg>

        {hoverPt && (
          <div className="mt-2 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-xs font-mono flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-zinc-400">{hoverPt.label}</span>
            <span className="text-[#FDB913]">{hoverPt.meta} WART/{assetName}</span>
          </div>
        )}
      </div>

      <div className={`${embedded ? 'px-4' : 'px-5'} py-2 border-t border-zinc-800 text-[10px] text-zinc-500`}>
        {plot.series.length} data point{plot.series.length !== 1 ? 's' : ''}
        {dataSpan ? ` · ${dataSpan}` : ''}
        {' · hover points for details'}
      </div>
    </div>
  );
};

export default AssetPriceChart;