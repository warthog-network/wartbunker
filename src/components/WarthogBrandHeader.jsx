import React, { useMemo } from 'react';
import { useWallet } from './WalletContext';
import { isDefiNode, resolveSavedNodeUrl } from '../utils/presetNodes.js';

function readStoredIsTestnet() {
  try {
    if (typeof localStorage === 'undefined') return true;
    return isDefiNode(resolveSavedNodeUrl(localStorage.getItem('selectedNode')));
  } catch {
    return true;
  }
}

/**
 * Brand mark for the wallet chrome.
 * When connected to a DeFi/testnet node, shows a live “Testnet” marker under NETWORK DEFI.
 */
const WarthogBrandHeader = ({ className = '', showTestnet }) => {
  const { selectedNode } = useWallet();

  const isOnTestnet = useMemo(() => {
    if (typeof showTestnet === 'boolean') return showTestnet;
    if (selectedNode) return isDefiNode(selectedNode);
    return readStoredIsTestnet();
  }, [showTestnet, selectedNode]);

  return (
    <div className={`flex items-center gap-2.5 min-w-0 ${className}`}>
      <img
        src="/vite.svg"
        alt=""
        className="w-9 h-9 flex-shrink-0"
        width={36}
        height={36}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <div className="text-[22px] font-semibold tracking-[-0.4px] text-[#FDB913] leading-tight">
          Warthog
        </div>
        <div className="text-[10px] text-zinc-500 -mt-0.5 font-mono tracking-wide">
          NETWORK DEFI
        </div>
        {isOnTestnet && (
          <div
            className="flex items-center gap-1.5 mt-0.5"
            title="Connected to a live Warthog DeFi testnet"
          >
            <span className="relative flex h-1.5 w-1.5 flex-shrink-0" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.65)]" />
            </span>
            <span className="text-[9px] font-mono font-medium tracking-[0.14em] uppercase text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.45)]">
              Testnet
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default WarthogBrandHeader;
