import React from 'react';
import { useNumberDisplay } from './NumberDisplayContext.jsx';

/**
 * Renders a formatted number or balance with the user's chosen accent color.
 * @param {{ value: unknown; variant?: 'number' | 'balance'; overrides?: object; className?: string; title?: string }} props
 */
export function FormattedNumber({
  value,
  variant = 'number',
  overrides,
  className = '',
  title,
}) {
  const { formatNumber, formatBalance, numberColorClass, balanceColorClass } = useNumberDisplay();
  const text = variant === 'balance' ? formatBalance(value, overrides) : formatNumber(value, overrides);
  const colorClass = variant === 'balance' ? balanceColorClass : numberColorClass;

  return (
    <span
      className={`tabular-nums font-mono ${colorClass}${className ? ` ${className}` : ''}`}
      title={title}
    >
      {text}
    </span>
  );
}

export default FormattedNumber;