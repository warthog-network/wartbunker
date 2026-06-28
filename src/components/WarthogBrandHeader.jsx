import React from 'react';

const WarthogBrandHeader = ({ className = '' }) => (
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
    </div>
  </div>
);

export default WarthogBrandHeader;