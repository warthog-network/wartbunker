import React from 'react';
import { useNumberDisplay } from './NumberDisplayContext.jsx';
import FormattedNumber from './FormattedNumber.jsx';
import {
  BRAND_COLOR_OPTIONS,
  BRAND_SWATCH_BASE,
  DEFAULT_NUMBER_DISPLAY_PREFS,
  FUN_COLOR_OPTIONS,
  NUMBER_COLOR_OPTIONS,
  NUMBER_DISPLAY_MODES,
} from '../utils/numberDisplay.js';

const PREVIEW_SAMPLES = [
  { label: 'Large supply', value: 1000000000, variant: 'number' },
  { label: 'Pool reserve', value: 2456789.12345678, variant: 'balance' },
  { label: 'Tiny price', value: 0.0000000342, variant: 'number' },
  { label: 'Limit price', value: 0.0001523, variant: 'number' },
];

const colorMeta = (colorId) =>
  NUMBER_COLOR_OPTIONS.find((c) => c.id === colorId) ?? NUMBER_COLOR_OPTIONS[0];

const swatchSizeClass = (size) => (size === 'lg' ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5');

const ColorSwatch = ({ color, size = 'sm' }) => {
  if (color.swatch) {
    return (
      <img
        src={`${BRAND_SWATCH_BASE}/${color.swatch}`}
        alt=""
        className={`rounded-full border border-white/20 flex-shrink-0 ${swatchSizeClass(size)}`}
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className={`rounded-full border border-white/20 flex-shrink-0 inline-block ${swatchSizeClass(size)}`}
      style={{ backgroundColor: color.hex }}
      aria-hidden="true"
    />
  );
};

const ColorOptionButton = ({ color, value, defaultValue, onChange }) => {
  const isActive = value === color.id;
  const isDefault = color.id === defaultValue;
  return (
    <button
      type="button"
      onClick={() => onChange(color.id)}
      title={isDefault ? `${color.label} — default` : color.label}
      className={`compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1 inline-flex items-center gap-1.5${
        isActive ? ' compact-btn--active' : ''
      }`}
    >
      <ColorSwatch color={color} />
      {isDefault ? 'Default' : color.label}
    </button>
  );
};

const ColorPickerRow = ({ label, description, value, defaultValue, onChange }) => (
  <div className={label ? 'mb-3 last:mb-0' : ''}>
    {label && <div className="text-xs text-zinc-400 mb-0.5">{label}</div>}
    {description && <p className="text-[11px] text-zinc-500 mb-2">{description}</p>}
    <div className="flex flex-wrap items-center gap-2">
      {BRAND_COLOR_OPTIONS.map((color) => (
        <ColorOptionButton
          key={color.id}
          color={color}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange}
        />
      ))}
    </div>
    <div className="mt-2.5">
      <div className="text-[10px] text-zinc-500 mb-1.5">Fun colors</div>
      <div className="flex flex-wrap items-center gap-2">
        {FUN_COLOR_OPTIONS.map((color) => (
          <ColorOptionButton
            key={color.id}
            color={color}
            value={value}
            defaultValue={defaultValue}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  </div>
);

const ColorPickerSection = ({ title, description, values = [], children }) => (
  <details className="group border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950/50">
    <summary className="cursor-pointer list-none flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-zinc-900/80 transition-colors select-none">
      <div className="flex items-center gap-2 min-w-0">
        <span className="group-open:rotate-90 inline-block transition text-zinc-500 text-[10px] flex-shrink-0">
          ▶
        </span>
        <div className="min-w-0">
          <div className="text-xs text-zinc-300">{title}</div>
          {description && (
            <div className="text-[10px] text-zinc-500 truncate">{description}</div>
          )}
        </div>
      </div>
      {values.length > 0 && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {values.map(({ id, label }) => (
            <div key={id} className="flex items-center gap-1">
              <ColorSwatch color={colorMeta(id)} size="lg" />
              {label && <span className="text-[10px] text-zinc-400 hidden sm:inline">{label}</span>}
            </div>
          ))}
        </div>
      )}
    </summary>
    <div className="px-3 pb-3 pt-2 border-t border-zinc-800">
      {children}
    </div>
  </details>
);

const NumberDisplaySettings = () => {
  const {
    prefs,
    setPrefs,
    resetPrefs,
    applyMode,
    activeMode,
    limitOrderBuyClasses,
    limitOrderSellClasses,
    liquidityPoolClasses,
  } = useNumberDisplay();

  const resetColorPrefs = () => setPrefs({
    numberColor: DEFAULT_NUMBER_DISPLAY_PREFS.numberColor,
    balanceColor: DEFAULT_NUMBER_DISPLAY_PREFS.balanceColor,
    limitOrderBuyColor: DEFAULT_NUMBER_DISPLAY_PREFS.limitOrderBuyColor,
    limitOrderSellColor: DEFAULT_NUMBER_DISPLAY_PREFS.limitOrderSellColor,
    liquidityPoolColor: DEFAULT_NUMBER_DISPLAY_PREFS.liquidityPoolColor,
  });

  return (
    <div className="bg-zinc-950 border border-zinc-700 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-semibold text-white mb-1">Number Display</h3>
          <p className="text-sm text-zinc-400">
            Choose a quick preset or fine-tune how numbers, balances, limit orders, and pool UI appear across the wallet.
          </p>
        </div>
        <button
          type="button"
          onClick={resetPrefs}
          className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1 flex-shrink-0"
        >
          Reset
        </button>
      </div>

      <div className="mb-4">
        <div className="text-xs text-zinc-400 mb-2">Quick presets</div>
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(NUMBER_DISPLAY_MODES).map(([modeId, mode]) => (
            <button
              key={modeId}
              type="button"
              onClick={() => applyMode(modeId)}
              title={mode.description}
              className={`compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1${
                activeMode === modeId ? ' compact-btn--active' : ''
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
        {activeMode == null ? (
          <p className="text-[11px] text-zinc-500 mt-2">Custom — manual tweaks differ from all presets.</p>
        ) : (
          <p className="text-[11px] text-zinc-500 mt-2">
            {NUMBER_DISPLAY_MODES[activeMode].description}
          </p>
        )}
      </div>

      <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Accent colors</div>
          <button
            type="button"
            onClick={resetColorPrefs}
            className="compact-btn hover:!text-[#E79300] !mx-0 !my-0 !px-3 !py-1 flex-shrink-0"
          >
            Color defaults
          </button>
        </div>

        <div className="space-y-2">
          <ColorPickerSection
            title="Number color"
            description="Prices, limits, and general numeric values"
            values={[{ id: prefs.numberColor, label: colorMeta(prefs.numberColor).label }]}
          >
            <ColorPickerRow
              value={prefs.numberColor}
              defaultValue={DEFAULT_NUMBER_DISPLAY_PREFS.numberColor}
              onChange={(numberColor) => setPrefs({ numberColor })}
            />
          </ColorPickerSection>

          <ColorPickerSection
            title="Balance color"
            description="Wallet balances, pool reserves, and LP share amounts"
            values={[{ id: prefs.balanceColor, label: colorMeta(prefs.balanceColor).label }]}
          >
            <ColorPickerRow
              value={prefs.balanceColor}
              defaultValue={DEFAULT_NUMBER_DISPLAY_PREFS.balanceColor}
              onChange={(balanceColor) => setPrefs({ balanceColor })}
            />
          </ColorPickerSection>

          <ColorPickerSection
            title="Limit orders"
            description="Buy and sell order badges, headers, and fill bars"
            values={[
              { id: prefs.limitOrderBuyColor, label: 'Buy' },
              { id: prefs.limitOrderSellColor, label: 'Sell' },
            ]}
          >
            <ColorPickerRow
              label="Buy orders"
              value={prefs.limitOrderBuyColor}
              defaultValue={DEFAULT_NUMBER_DISPLAY_PREFS.limitOrderBuyColor}
              onChange={(limitOrderBuyColor) => setPrefs({ limitOrderBuyColor })}
            />
            <ColorPickerRow
              label="Sell orders"
              value={prefs.limitOrderSellColor}
              defaultValue={DEFAULT_NUMBER_DISPLAY_PREFS.limitOrderSellColor}
              onChange={(limitOrderSellColor) => setPrefs({ limitOrderSellColor })}
            />
          </ColorPickerSection>

          <ColorPickerSection
            title="Liquidity pool"
            description="Pool cards, LP positions, and reserve labels"
            values={[{ id: prefs.liquidityPoolColor, label: colorMeta(prefs.liquidityPoolColor).label }]}
          >
            <ColorPickerRow
              value={prefs.liquidityPoolColor}
              defaultValue={DEFAULT_NUMBER_DISPLAY_PREFS.liquidityPoolColor}
              onChange={(liquidityPoolColor) => setPrefs({ liquidityPoolColor })}
            />
          </ColorPickerSection>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs font-mono mt-3 pt-3 border-t border-zinc-800">
          <span className={`px-2 py-0.5 rounded ${limitOrderBuyClasses.bgMuted} ${limitOrderBuyClasses.text}`}>
            BUY
          </span>
          <span className={`px-2 py-0.5 rounded ${limitOrderSellClasses.bgMuted} ${limitOrderSellClasses.text}`}>
            SELL
          </span>
          <span className={`px-2 py-0.5 rounded ${liquidityPoolClasses.bgMuted} ${liquidityPoolClasses.text}`}>
            LP POOL
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div>
          <label className="block text-xs text-zinc-400 mb-1.5">Decimal places (max)</label>
          <select
            value={prefs.maxDecimals == null ? 'full' : String(prefs.maxDecimals)}
            onChange={(e) => {
              const v = e.target.value;
              setPrefs({ maxDecimals: v === 'full' ? null : parseInt(v, 10) });
            }}
            className="input"
          >
            <option value="full">Full precision</option>
            {[0, 2, 4, 6, 8, 10, 12].map((n) => (
              <option key={n} value={n}>{n} decimals</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1.5">Significant figures</label>
          <select
            value={prefs.sigFigs == null ? 'off' : String(prefs.sigFigs)}
            onChange={(e) => {
              const v = e.target.value;
              setPrefs({ sigFigs: v === 'off' ? null : parseInt(v, 10) });
            }}
            className="input"
          >
            <option value="off">Off (use decimals)</option>
            {[2, 3, 4, 5, 6, 8].map((n) => (
              <option key={n} value={n}>{n} sig figs</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1.5">Notation</label>
          <select
            value={prefs.notation}
            onChange={(e) => setPrefs({ notation: e.target.value })}
            className="input"
          >
            <option value="standard">Standard (1,234.56)</option>
            <option value="compact">Compact (1.23M, 456K)</option>
            <option value="scientific">Scientific (1.23e+6)</option>
          </select>
        </div>

        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.useGrouping}
              onChange={(e) => setPrefs({ useGrouping: e.target.checked })}
              className="rounded border-zinc-600"
            />
            Thousand separators
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.trimTrailingZeros}
              onChange={(e) => setPrefs({ trimTrailingZeros: e.target.checked })}
              className="rounded border-zinc-600"
            />
            Trim trailing zeros
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-2">Preview</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-white">
          {PREVIEW_SAMPLES.map((sample) => (
            <div key={sample.label} className="flex justify-between gap-3">
              <span className="text-zinc-500">{sample.label}</span>
              <FormattedNumber value={sample.value} variant={sample.variant} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default NumberDisplaySettings;