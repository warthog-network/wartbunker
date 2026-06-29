import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  DEFAULT_NUMBER_DISPLAY_PREFS,
  detectNumberDisplayMode,
  formatDisplayBalance,
  formatDisplayNumber,
  getBrandColorClasses,
  getNumberColorClass,
  loadNumberDisplayPrefs,
  normalizeNumberDisplayPrefs,
  prefsForNumberDisplayMode,
  saveNumberDisplayPrefs,
} from '../utils/numberDisplay.js';

const NumberDisplayContext = createContext(null);

export function NumberDisplayProvider({ children }) {
  const [prefs, setPrefsState] = useState(() => loadNumberDisplayPrefs());

  const setPrefs = useCallback((next) => {
    setPrefsState((prev) => {
      const merged = normalizeNumberDisplayPrefs(
        typeof next === 'function' ? next(prev) : { ...prev, ...next },
      );
      return saveNumberDisplayPrefs(merged);
    });
  }, []);

  const resetPrefs = useCallback(() => {
    setPrefsState(saveNumberDisplayPrefs(DEFAULT_NUMBER_DISPLAY_PREFS));
  }, []);

  const applyMode = useCallback((modeId) => {
    setPrefsState((prev) => saveNumberDisplayPrefs({
      ...prefsForNumberDisplayMode(modeId),
      numberColor: prev.numberColor,
      balanceColor: prev.balanceColor,
      limitOrderBuyColor: prev.limitOrderBuyColor,
      limitOrderSellColor: prev.limitOrderSellColor,
      liquidityPoolColor: prev.liquidityPoolColor,
    }));
  }, []);

  const formatNumber = useCallback(
    (value, overrides) => formatDisplayNumber(value, prefs, overrides),
    [prefs],
  );

  const formatBalance = useCallback(
    (value, overrides) => formatDisplayBalance(value, prefs, overrides),
    [prefs],
  );

  const numberColorClass = useMemo(
    () => getNumberColorClass(prefs.numberColor),
    [prefs.numberColor],
  );

  const balanceColorClass = useMemo(
    () => getNumberColorClass(prefs.balanceColor),
    [prefs.balanceColor],
  );

  const limitOrderBuyClasses = useMemo(
    () => getBrandColorClasses(prefs.limitOrderBuyColor),
    [prefs.limitOrderBuyColor],
  );

  const limitOrderSellClasses = useMemo(
    () => getBrandColorClasses(prefs.limitOrderSellColor),
    [prefs.limitOrderSellColor],
  );

  const liquidityPoolClasses = useMemo(
    () => getBrandColorClasses(prefs.liquidityPoolColor),
    [prefs.liquidityPoolColor],
  );

  const activeMode = useMemo(() => detectNumberDisplayMode(prefs), [prefs]);

  const value = useMemo(
    () => ({
      prefs,
      setPrefs,
      resetPrefs,
      applyMode,
      activeMode,
      numberColorClass,
      balanceColorClass,
      limitOrderBuyClasses,
      limitOrderSellClasses,
      liquidityPoolClasses,
      formatNumber,
      formatBalance,
    }),
    [
      prefs,
      setPrefs,
      resetPrefs,
      applyMode,
      activeMode,
      numberColorClass,
      balanceColorClass,
      limitOrderBuyClasses,
      limitOrderSellClasses,
      liquidityPoolClasses,
      formatNumber,
      formatBalance,
    ],
  );

  return (
    <NumberDisplayContext.Provider value={value}>
      {children}
    </NumberDisplayContext.Provider>
  );
}

export function useNumberDisplay() {
  const ctx = useContext(NumberDisplayContext);
  if (!ctx) {
    throw new Error('useNumberDisplay must be used within NumberDisplayProvider');
  }
  return ctx;
}