import React from 'react';
import FormattedNumber from './FormattedNumber.jsx';

/** True when a locked amount string/number is meaningfully &gt; 0. */
export function hasPositiveLocked(locked) {
  if (locked == null || locked === '') return false;
  if (typeof locked === 'object') {
    const n = parseFloat(locked.str ?? locked.E8 ?? locked.u64 ?? '0');
    return Number.isFinite(n) && n > 0;
  }
  const n = parseFloat(locked);
  return Number.isFinite(n) && n > 0;
}

/**
 * Consistent Available / Locked / Total presentation for WART and assets.
 *
 * @param {object} props
 * @param {unknown} [props.available] Free to spend (total − locked − mempool)
 * @param {unknown} [props.locked] Locked in open orders / pending
 * @param {unknown} [props.total] Full on-chain total
 * @param {string} [props.unit] Symbol (WART, MHJ, …)
 * @param {string} [props.label] Primary row label (default "Available")
 * @param {'stack' | 'inline' | 'row' | 'hero'} [props.layout]
 * @param {boolean} [props.showLabel]
 * @param {string} [props.className]
 * @param {string} [props.primaryClassName]
 * @param {string} [props.unitClassName]
 */
export default function SpendableBalanceDisplay({
  available,
  locked,
  total,
  unit = '',
  label = 'Available',
  layout = 'stack',
  showLabel = true,
  className = '',
  primaryClassName = '',
  unitClassName = 'text-[#FDB913]',
}) {
  const free = available ?? total ?? '0';
  const showLocked = hasPositiveLocked(locked);
  const totalVal = total ?? free;

  const unitEl = unit ? (
    <span className={`font-sans ${unitClassName}`}>{unit}</span>
  ) : null;

  const lockedTotalLine = showLocked ? (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-zinc-500">
      <span>
        Total{' '}
        <FormattedNumber value={totalVal} variant="balance" className="text-zinc-400 font-mono" />
      </span>
      <span className="text-amber-400/90">
        Locked{' '}
        <FormattedNumber value={locked} variant="balance" className="text-amber-300 font-mono" />
        {layout === 'hero' ? (
          <span className="text-zinc-500"> (open orders)</span>
        ) : null}
      </span>
    </div>
  ) : null;

  if (layout === 'hero') {
    return (
      <div className={className}>
        {showLabel && (
          <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-medium mb-1">
            {showLocked ? 'Available Balance' : label === 'Available' ? 'Total Balance' : label}
          </div>
        )}
        <div className={`flex items-baseline gap-2 min-w-0 flex-wrap text-white ${primaryClassName}`}>
          <FormattedNumber
            value={free}
            variant="balance"
            className="text-3xl font-semibold tracking-tight break-all"
          />
          {unitEl}
        </div>
        {showLocked && <div className="mt-2">{lockedTotalLine}</div>}
      </div>
    );
  }

  if (layout === 'row') {
    // Compact list-row style (wallet asset list): primary free amount + optional locked line under it
    return (
      <div className={`font-mono text-xs sm:text-sm text-white tabular-nums ${className}`}>
        <div className="truncate">
          <FormattedNumber value={free} variant="balance" className={primaryClassName} />
          {unit ? <span className={`text-[10px] text-zinc-400 ml-1 font-sans ${unitClassName}`}>{unit}</span> : null}
        </div>
        {showLocked && (
          <div className="mt-0.5 flex flex-wrap justify-start sm:justify-end gap-x-2 gap-y-0.5 text-[10px] text-zinc-500 font-sans normal-nums">
            <span>
              Total{' '}
              <FormattedNumber value={totalVal} variant="balance" className="text-zinc-400" />
            </span>
            <span className="text-amber-400/90">
              Locked{' '}
              <FormattedNumber value={locked} variant="balance" className="text-amber-300" />
            </span>
          </div>
        )}
      </div>
    );
  }

  if (layout === 'inline') {
    return (
      <span className={`tabular-nums ${className}`}>
        <FormattedNumber value={free} variant="balance" className={primaryClassName} />
        {unit ? <> {unitEl}</> : null}
        {showLocked && (
          <span className="text-zinc-500 text-[11px] ml-2">
            (locked{' '}
            <FormattedNumber value={locked} variant="balance" className="text-amber-300 font-mono" />
            {total != null && (
              <>
                {' · '}total{' '}
                <FormattedNumber value={totalVal} variant="balance" className="text-zinc-400 font-mono" />
              </>
            )}
            )
          </span>
        )}
      </span>
    );
  }

  // stack — form cards (Send, limit order, volume tool)
  return (
    <div className={`text-xs space-y-1 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        {showLabel ? <span className="text-zinc-500">{label}</span> : <span />}
        <span className={`font-mono text-white tabular-nums ${primaryClassName}`}>
          <FormattedNumber value={free} variant="balance" />
          {unit ? <>{' '}{unitEl}</> : null}
        </span>
      </div>
      {showLocked && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
          <span>
            Locked{' '}
            <FormattedNumber value={locked} variant="balance" className="text-amber-300 font-mono" />
          </span>
          <span>
            Total{' '}
            <FormattedNumber value={totalVal} variant="balance" className="text-zinc-400 font-mono" />
          </span>
        </div>
      )}
    </div>
  );
}
