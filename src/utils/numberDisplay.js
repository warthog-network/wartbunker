export const NUMBER_DISPLAY_PREFS_KEY = 'wartbunkerNumberDisplayPrefs';

/** @typedef {'standard' | 'compact' | 'scientific'} NumberNotation */
/** @typedef {'simple' | 'standard' | 'precise'} NumberDisplayMode */
/** Local brand-kit swatch SVGs — solid fills + gradient references. */
export const BRAND_SWATCH_BASE = '/brand-colors';

/**
 * Official Warthog brand-kit solid colors (public/brand-colors/*.svg).
 * Gradient swatches (E79300-FDB913, F20544-FDB913, F25C05-FDB913) are reference-only — not text accents.
 */
export const BRAND_PALETTE = {
  white: { hex: '#FFFFFF', swatch: 'FFFFFF.svg' },
  gray: { hex: '#E9E9E9', swatch: 'E9E9E9.svg' },
  gold: { hex: '#FDB913', swatch: 'FDB913.svg' },
  orange: { hex: '#E79300', swatch: 'E79300.svg' },
  flame: { hex: '#F25C05', swatch: 'F25C05.svg' },
  rose: { hex: '#F20544', swatch: 'F20544.svg' },
  blue: { hex: '#035AA6', swatch: '035AA6.svg' },
  navy: { hex: '#033298', swatch: '033298.svg' },
  black: { hex: '#000000', swatch: '000000.svg' },
};

/** @typedef {keyof typeof BRAND_PALETTE | 'green' | 'lime' | 'cyan' | 'purple' | 'pink'} NumberColorId */

/**
 * @typedef {Object} NumberDisplayPrefs
 * @property {number | null} maxDecimals Cap fractional digits (null = no cap beyond trim)
 * @property {number | null} sigFigs Significant figures (overrides maxDecimals when set)
 * @property {NumberNotation} notation
 * @property {boolean} useGrouping Thousand separators in standard notation
 * @property {boolean} trimTrailingZeros Drop insignificant trailing zeros
 * @property {NumberColorId} numberColor Accent color for prices and general numbers
 * @property {NumberColorId} balanceColor Accent color for balances and reserves
 * @property {NumberColorId} limitOrderBuyColor Accent for buy limit orders
 * @property {NumberColorId} limitOrderSellColor Accent for sell limit orders
 * @property {NumberColorId} liquidityPoolColor Accent for liquidity pool UI
 */

/** Quick presets that bundle the most common formatting choices. */
export const NUMBER_DISPLAY_MODES = {
  simple: {
    label: 'Simple',
    description: 'Rounded & compact — easy to scan at a glance',
    maxDecimals: 2,
    sigFigs: null,
    notation: 'compact',
    useGrouping: true,
    trimTrailingZeros: true,
  },
  standard: {
    label: 'Standard',
    description: 'Balanced precision for everyday wallet use',
    maxDecimals: 8,
    sigFigs: null,
    notation: 'standard',
    useGrouping: true,
    trimTrailingZeros: true,
  },
  precise: {
    label: 'Precise',
    description: 'Full precision with every digit kept',
    maxDecimals: null,
    sigFigs: null,
    notation: 'standard',
    useGrouping: true,
    trimTrailingZeros: false,
  },
};

/** Official brand-kit accent options (swatch SVGs in public/brand-colors/). */
export const BRAND_COLOR_OPTIONS = [
  { id: 'white', label: 'White', className: 'text-white', swatch: BRAND_PALETTE.white.swatch, hex: BRAND_PALETTE.white.hex },
  { id: 'gray', label: 'Gray', className: 'text-[#E9E9E9]', swatch: BRAND_PALETTE.gray.swatch, hex: BRAND_PALETTE.gray.hex },
  { id: 'gold', label: 'Gold', className: 'text-[#FDB913]', swatch: BRAND_PALETTE.gold.swatch, hex: BRAND_PALETTE.gold.hex },
  { id: 'orange', label: 'Orange', className: 'text-[#E79300]', swatch: BRAND_PALETTE.orange.swatch, hex: BRAND_PALETTE.orange.hex },
  { id: 'flame', label: 'Flame', className: 'text-[#F25C05]', swatch: BRAND_PALETTE.flame.swatch, hex: BRAND_PALETTE.flame.hex },
  { id: 'rose', label: 'Rose', className: 'text-[#F20544]', swatch: BRAND_PALETTE.rose.swatch, hex: BRAND_PALETTE.rose.hex },
  { id: 'blue', label: 'Blue', className: 'text-[#035AA6]', swatch: BRAND_PALETTE.blue.swatch, hex: BRAND_PALETTE.blue.hex },
  { id: 'navy', label: 'Navy', className: 'text-[#033298]', swatch: BRAND_PALETTE.navy.swatch, hex: BRAND_PALETTE.navy.hex },
  { id: 'black', label: 'Black', className: 'text-black', swatch: BRAND_PALETTE.black.swatch, hex: BRAND_PALETTE.black.hex },
];

/** Extra accents outside the brand kit — for personal flair. */
export const FUN_COLOR_OPTIONS = [
  { id: 'green', label: 'Green', className: 'text-[#34D399]', hex: '#34D399', fun: true },
  { id: 'lime', label: 'Lime', className: 'text-[#A3E635]', hex: '#A3E635', fun: true },
  { id: 'cyan', label: 'Cyan', className: 'text-[#22D3EE]', hex: '#22D3EE', fun: true },
  { id: 'purple', label: 'Purple', className: 'text-[#A855F7]', hex: '#A855F7', fun: true },
  { id: 'pink', label: 'Pink', className: 'text-[#F472B6]', hex: '#F472B6', fun: true },
];

/** All selectable accent colors (brand + fun). */
export const NUMBER_COLOR_OPTIONS = [...BRAND_COLOR_OPTIONS, ...FUN_COLOR_OPTIONS];

/** Static Tailwind classes per brand color (required for JIT). */
export const BRAND_COLOR_CLASSES = {
  white: {
    text: 'text-white',
    textMuted: 'text-white/70',
    textFaint: 'text-white/60',
    textDim: 'text-white/50',
    bgMuted: 'bg-white/10',
    bgSolid: 'bg-white',
    bgPanel: 'bg-white/5',
    border: 'border-white',
    borderMuted: 'border-white/40',
    borderPanel: 'border-white/60',
    groupHoverText: 'group-hover:text-white',
  },
  gray: {
    text: 'text-[#E9E9E9]',
    textMuted: 'text-[#E9E9E9]/70',
    textFaint: 'text-[#E9E9E9]/60',
    textDim: 'text-[#E9E9E9]/50',
    bgMuted: 'bg-[#E9E9E9]/10',
    bgSolid: 'bg-[#E9E9E9]',
    bgPanel: 'bg-[#E9E9E9]/10',
    border: 'border-[#E9E9E9]',
    borderMuted: 'border-[#E9E9E9]/40',
    borderPanel: 'border-[#E9E9E9]/60',
    groupHoverText: 'group-hover:text-[#E9E9E9]',
  },
  gold: {
    text: 'text-[#FDB913]',
    textMuted: 'text-[#FDB913]/70',
    textFaint: 'text-[#FDB913]/60',
    textDim: 'text-[#FDB913]/50',
    bgMuted: 'bg-[#FDB913]/10',
    bgSolid: 'bg-[#FDB913]',
    bgPanel: 'bg-[#FDB913]/10',
    border: 'border-[#FDB913]',
    borderMuted: 'border-[#FDB913]/40',
    borderPanel: 'border-[#FDB913]/60',
    groupHoverText: 'group-hover:text-[#FDB913]',
  },
  orange: {
    text: 'text-[#E79300]',
    textMuted: 'text-[#E79300]/70',
    textFaint: 'text-[#E79300]/60',
    textDim: 'text-[#E79300]/50',
    bgMuted: 'bg-[#E79300]/10',
    bgSolid: 'bg-[#E79300]',
    bgPanel: 'bg-[#E79300]/10',
    border: 'border-[#E79300]',
    borderMuted: 'border-[#E79300]/40',
    borderPanel: 'border-[#E79300]/60',
    groupHoverText: 'group-hover:text-[#E79300]',
  },
  flame: {
    text: 'text-[#F25C05]',
    textMuted: 'text-[#F25C05]/70',
    textFaint: 'text-[#F25C05]/60',
    textDim: 'text-[#F25C05]/50',
    bgMuted: 'bg-[#F25C05]/10',
    bgSolid: 'bg-[#F25C05]',
    bgPanel: 'bg-[#F25C05]/10',
    border: 'border-[#F25C05]',
    borderMuted: 'border-[#F25C05]/40',
    borderPanel: 'border-[#F25C05]/60',
    groupHoverText: 'group-hover:text-[#F25C05]',
  },
  rose: {
    text: 'text-[#F20544]',
    textMuted: 'text-[#F20544]/70',
    textFaint: 'text-[#F20544]/60',
    textDim: 'text-[#F20544]/50',
    bgMuted: 'bg-[#F20544]/10',
    bgSolid: 'bg-[#F20544]',
    bgPanel: 'bg-[#F20544]/10',
    border: 'border-[#F20544]',
    borderMuted: 'border-[#F20544]/40',
    borderPanel: 'border-[#F20544]/60',
    groupHoverText: 'group-hover:text-[#F20544]',
  },
  blue: {
    text: 'text-[#035AA6]',
    textMuted: 'text-[#035AA6]/70',
    textFaint: 'text-[#035AA6]/60',
    textDim: 'text-[#035AA6]/50',
    bgMuted: 'bg-[#035AA6]/10',
    bgSolid: 'bg-[#035AA6]',
    bgPanel: 'bg-[#035AA6]/10',
    border: 'border-[#035AA6]',
    borderMuted: 'border-[#035AA6]/40',
    borderPanel: 'border-[#035AA6]/60',
    groupHoverText: 'group-hover:text-[#035AA6]',
  },
  navy: {
    text: 'text-[#033298]',
    textMuted: 'text-[#033298]/70',
    textFaint: 'text-[#033298]/60',
    textDim: 'text-[#033298]/50',
    bgMuted: 'bg-[#033298]/10',
    bgSolid: 'bg-[#033298]',
    bgPanel: 'bg-[#033298]/10',
    border: 'border-[#033298]',
    borderMuted: 'border-[#033298]/40',
    borderPanel: 'border-[#033298]/60',
    groupHoverText: 'group-hover:text-[#033298]',
  },
  black: {
    text: 'text-black',
    textMuted: 'text-black/70',
    textFaint: 'text-black/60',
    textDim: 'text-black/50',
    bgMuted: 'bg-black/10',
    bgSolid: 'bg-black',
    bgPanel: 'bg-black/20',
    border: 'border-black',
    borderMuted: 'border-black/40',
    borderPanel: 'border-black/60',
    groupHoverText: 'group-hover:text-black',
  },
  green: {
    text: 'text-[#34D399]',
    textMuted: 'text-[#34D399]/70',
    textFaint: 'text-[#34D399]/60',
    textDim: 'text-[#34D399]/50',
    bgMuted: 'bg-[#34D399]/10',
    bgSolid: 'bg-[#34D399]',
    bgPanel: 'bg-[#34D399]/10',
    border: 'border-[#34D399]',
    borderMuted: 'border-[#34D399]/40',
    borderPanel: 'border-[#34D399]/60',
    groupHoverText: 'group-hover:text-[#34D399]',
  },
  lime: {
    text: 'text-[#A3E635]',
    textMuted: 'text-[#A3E635]/70',
    textFaint: 'text-[#A3E635]/60',
    textDim: 'text-[#A3E635]/50',
    bgMuted: 'bg-[#A3E635]/10',
    bgSolid: 'bg-[#A3E635]',
    bgPanel: 'bg-[#A3E635]/10',
    border: 'border-[#A3E635]',
    borderMuted: 'border-[#A3E635]/40',
    borderPanel: 'border-[#A3E635]/60',
    groupHoverText: 'group-hover:text-[#A3E635]',
  },
  cyan: {
    text: 'text-[#22D3EE]',
    textMuted: 'text-[#22D3EE]/70',
    textFaint: 'text-[#22D3EE]/60',
    textDim: 'text-[#22D3EE]/50',
    bgMuted: 'bg-[#22D3EE]/10',
    bgSolid: 'bg-[#22D3EE]',
    bgPanel: 'bg-[#22D3EE]/10',
    border: 'border-[#22D3EE]',
    borderMuted: 'border-[#22D3EE]/40',
    borderPanel: 'border-[#22D3EE]/60',
    groupHoverText: 'group-hover:text-[#22D3EE]',
  },
  purple: {
    text: 'text-[#A855F7]',
    textMuted: 'text-[#A855F7]/70',
    textFaint: 'text-[#A855F7]/60',
    textDim: 'text-[#A855F7]/50',
    bgMuted: 'bg-[#A855F7]/10',
    bgSolid: 'bg-[#A855F7]',
    bgPanel: 'bg-[#A855F7]/10',
    border: 'border-[#A855F7]',
    borderMuted: 'border-[#A855F7]/40',
    borderPanel: 'border-[#A855F7]/60',
    groupHoverText: 'group-hover:text-[#A855F7]',
  },
  pink: {
    text: 'text-[#F472B6]',
    textMuted: 'text-[#F472B6]/70',
    textFaint: 'text-[#F472B6]/60',
    textDim: 'text-[#F472B6]/50',
    bgMuted: 'bg-[#F472B6]/10',
    bgSolid: 'bg-[#F472B6]',
    bgPanel: 'bg-[#F472B6]/10',
    border: 'border-[#F472B6]',
    borderMuted: 'border-[#F472B6]/40',
    borderPanel: 'border-[#F472B6]/60',
    groupHoverText: 'group-hover:text-[#F472B6]',
  },
};

const LEGACY_NUMBER_COLORS = {
  emerald: 'green',
  cyan: 'cyan',
  violet: 'purple',
  silver: 'gray',
  muted: 'gray',
  cream: 'gold',
  amber: 'gold',
  deep: 'orange',
};

const LEGACY_ACCENT_COLORS = {
  ...LEGACY_NUMBER_COLORS,
  red: 'rose',
};

export const DEFAULT_NUMBER_DISPLAY_PREFS = {
  maxDecimals: 8,
  sigFigs: null,
  notation: 'standard',
  useGrouping: true,
  trimTrailingZeros: true,
  numberColor: 'white',
  balanceColor: 'white',
  limitOrderBuyColor: 'blue',
  limitOrderSellColor: 'rose',
  liquidityPoolColor: 'gold',
};

/** @param {string | undefined} colorId @param {NumberColorId} fallback */
function normalizeColorId(colorId, fallback) {
  const resolved = LEGACY_ACCENT_COLORS[colorId] ?? colorId;
  return NUMBER_COLOR_OPTIONS.some((c) => c.id === resolved) ? resolved : fallback;
}

/** @returns {NumberDisplayPrefs} */
export function loadNumberDisplayPrefs() {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_NUMBER_DISPLAY_PREFS };
    const raw = localStorage.getItem(NUMBER_DISPLAY_PREFS_KEY);
    if (!raw) return { ...DEFAULT_NUMBER_DISPLAY_PREFS };
    const parsed = JSON.parse(raw);
    return normalizeNumberDisplayPrefs(parsed);
  } catch {
    return { ...DEFAULT_NUMBER_DISPLAY_PREFS };
  }
}

/** @param {Partial<NumberDisplayPrefs>} prefs */
export function saveNumberDisplayPrefs(prefs) {
  const normalized = normalizeNumberDisplayPrefs(prefs);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(NUMBER_DISPLAY_PREFS_KEY, JSON.stringify(normalized));
    }
  } catch {
    // ignore quota / private mode
  }
  return normalized;
}

/** @param {Partial<NumberDisplayPrefs> | null | undefined} prefs */
export function normalizeNumberDisplayPrefs(prefs) {
  const notation = ['standard', 'compact', 'scientific'].includes(prefs?.notation)
    ? prefs.notation
    : DEFAULT_NUMBER_DISPLAY_PREFS.notation;

  const maxDecimalsRaw = prefs?.maxDecimals;
  const maxDecimals = maxDecimalsRaw == null || maxDecimalsRaw === ''
    ? null
    : Math.min(18, Math.max(0, parseInt(maxDecimalsRaw, 10) || 0));

  const sigFigsRaw = prefs?.sigFigs;
  const sigFigs = sigFigsRaw == null || sigFigsRaw === ''
    ? null
    : Math.min(12, Math.max(1, parseInt(sigFigsRaw, 10) || 1));

  const numberColor = normalizeColorId(prefs?.numberColor, DEFAULT_NUMBER_DISPLAY_PREFS.numberColor);
  const balanceColor = prefs?.balanceColor != null
    ? normalizeColorId(prefs.balanceColor, DEFAULT_NUMBER_DISPLAY_PREFS.balanceColor)
    : numberColor;
  const limitOrderBuyColor = normalizeColorId(
    prefs?.limitOrderBuyColor,
    DEFAULT_NUMBER_DISPLAY_PREFS.limitOrderBuyColor,
  );
  const limitOrderSellColor = normalizeColorId(
    prefs?.limitOrderSellColor,
    DEFAULT_NUMBER_DISPLAY_PREFS.limitOrderSellColor,
  );
  const liquidityPoolColor = normalizeColorId(
    prefs?.liquidityPoolColor,
    DEFAULT_NUMBER_DISPLAY_PREFS.liquidityPoolColor,
  );

  return {
    maxDecimals,
    sigFigs,
    notation,
    useGrouping: prefs?.useGrouping !== false,
    trimTrailingZeros: prefs?.trimTrailingZeros !== false,
    numberColor,
    balanceColor,
    limitOrderBuyColor,
    limitOrderSellColor,
    liquidityPoolColor,
  };
}

/** @param {NumberColorId | string | undefined} colorId */
export function getNumberColorClass(colorId) {
  const resolved = normalizeColorId(colorId, DEFAULT_NUMBER_DISPLAY_PREFS.numberColor);
  return NUMBER_COLOR_OPTIONS.find((c) => c.id === resolved)?.className
    ?? NUMBER_COLOR_OPTIONS[0].className;
}

/** @param {NumberColorId | string | undefined} colorId */
export function getBrandColorClasses(colorId) {
  const resolved = normalizeColorId(colorId, DEFAULT_NUMBER_DISPLAY_PREFS.numberColor);
  return BRAND_COLOR_CLASSES[resolved] ?? BRAND_COLOR_CLASSES.white;
}

/** @param {Partial<NumberDisplayPrefs>} prefs */
export function detectNumberDisplayMode(prefs) {
  const normalized = normalizeNumberDisplayPrefs(prefs);
  for (const [modeId, preset] of Object.entries(NUMBER_DISPLAY_MODES)) {
    const matches = Object.entries(preset).every(([key, value]) => {
      if (key === 'label' || key === 'description') return true;
      return normalized[key] === value;
    });
    if (matches) return /** @type {NumberDisplayMode} */ (modeId);
  }
  return null;
}

/** @param {NumberDisplayMode} modeId */
export function prefsForNumberDisplayMode(modeId) {
  const preset = NUMBER_DISPLAY_MODES[modeId];
  if (!preset) return { ...DEFAULT_NUMBER_DISPLAY_PREFS };
  const { label, description, ...values } = preset;
  return normalizeNumberDisplayPrefs({ ...DEFAULT_NUMBER_DISPLAY_PREFS, ...values });
}

/**
 * Coerce API values (string, number, balance objects) into a finite number when possible.
 * @param {unknown} input
 * @returns {number | null}
 */
export function coerceDisplayNumber(input) {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof input === 'object') {
    const obj = /** @type {{ str?: string; doubleAdjusted?: number; E8?: string | number; u64?: string | number; decimals?: number }} */ (input);
    if (obj.str != null) return coerceDisplayNumber(obj.str);
    if (obj.doubleAdjusted != null) return coerceDisplayNumber(obj.doubleAdjusted);
    if (obj.E8 !== undefined) return Number(obj.E8) / 1e8;
    if (obj.u64 !== undefined) {
      // Token/WART fixed-point: apply decimals (default 8). Never show raw u64.
      const decimals = Number.isFinite(Number(obj.decimals))
        ? Math.min(18, Math.max(0, Number(obj.decimals)))
        : 8;
      return Number(obj.u64) / 10 ** decimals;
    }
  }
  return null;
}

/**
 * @param {number} value
 * @param {number} sigFigs
 */
function formatWithSigFigs(value, sigFigs) {
  if (value === 0) return '0';
  const rounded = Number(value.toPrecision(sigFigs));
  return Number.isFinite(rounded) ? String(rounded) : String(value);
}

/**
 * @param {string} s
 * @param {boolean} trimTrailingZeros
 */
function trimFractionZeros(s, trimTrailingZeros) {
  if (!trimTrailingZeros || !s.includes('.')) return s;
  return s.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1') || '0';
}

/**
 * Format a numeric value for human-readable display.
 * @param {unknown} input
 * @param {Partial<NumberDisplayPrefs>} [prefs]
 * @param {{ fallback?: string; maxDecimals?: number | null }} [overrides]
 */
export function formatDisplayNumber(input, prefs = {}, overrides = {}) {
  const options = normalizeNumberDisplayPrefs({ ...loadNumberDisplayPrefs(), ...prefs });
  const fallback = overrides.fallback ?? '—';
  const maxDecimals = overrides.maxDecimals !== undefined ? overrides.maxDecimals : options.maxDecimals;

  if (typeof input === 'string' && input.trim() && coerceDisplayNumber(input) == null) {
    return input.trim();
  }

  const value = coerceDisplayNumber(input);
  if (value == null || !Number.isFinite(value)) return fallback;
  if (value === 0) return '0';

  if (options.notation === 'compact' && Math.abs(value) >= 1000) {
    const digits = options.sigFigs != null
      ? Math.max(0, options.sigFigs - 1)
      : (maxDecimals ?? 2);
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: Math.min(6, digits),
      minimumFractionDigits: 0,
    }).format(value);
  }

  const tinyThreshold = 10 ** -(maxDecimals ?? 8);
  const useScientific = options.notation === 'scientific'
    || (options.notation === 'standard' && Math.abs(value) > 0 && Math.abs(value) < tinyThreshold);

  if (useScientific) {
    const digits = options.sigFigs ?? maxDecimals ?? 4;
    let exp = value.toExponential(Math.min(8, Math.max(0, digits)));
    if (options.trimTrailingZeros) {
      exp = exp.replace(/(\.\d*?[1-9])0+e/, '$1e').replace(/\.0+e/, 'e');
    }
    return exp;
  }

  let formatted;
  if (options.sigFigs != null) {
    formatted = formatWithSigFigs(value, options.sigFigs);
    if (options.useGrouping) {
      const [whole, frac = ''] = formatted.split('.');
      const groupedWhole = new Intl.NumberFormat('en-US', { useGrouping: true, maximumFractionDigits: 0 })
        .format(Number(whole));
      formatted = frac ? `${groupedWhole}.${frac}` : groupedWhole;
    }
  } else if (maxDecimals != null) {
    formatted = value.toFixed(maxDecimals);
    if (options.useGrouping) {
      const [whole, frac = ''] = formatted.split('.');
      const groupedWhole = new Intl.NumberFormat('en-US', { useGrouping: true, maximumFractionDigits: 0 })
        .format(Number(whole));
      formatted = frac ? `${groupedWhole}.${frac}` : groupedWhole;
    }
  } else if (options.useGrouping) {
    formatted = new Intl.NumberFormat('en-US', {
      useGrouping: true,
      maximumFractionDigits: 20,
    }).format(value);
  } else {
    formatted = String(value);
  }

  return trimFractionZeros(formatted, options.trimTrailingZeros);
}

/** Format balance-like API values (objects or strings) using display prefs. */
export function formatDisplayBalance(input, prefs = {}, overrides = {}) {
  if (input != null && typeof input === 'object' && input.str != null) {
    return formatDisplayNumber(input.str, prefs, { fallback: '0', ...overrides });
  }
  return formatDisplayNumber(input, prefs, { fallback: '0', ...overrides });
}