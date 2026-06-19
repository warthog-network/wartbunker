import { normalizeNodeUrl } from './warthogClient.js';

/** Preset DeFi testnet nodes shown in the Node Selection dropdown. */
export const PRESET_NODES = [
  { url: 'http://65.87.7.86:3002', name: 'Testnet 1' },
  { url: 'http://104.251.219.14:3001', name: 'Testnet 2' },
  { url: 'http://85.56.145.106:3001', name: 'Testnet 3' },
  { url: 'http://209.127.34.202:3001', name: 'Testnet 4' },
];

export const DEFAULT_NODE_URL = PRESET_NODES[0].url;

export const DEFI_TESTNET_URL = 'https://warthog-defitestnet.duckdns.org';

export const PRESET_NODE_URLS = PRESET_NODES.map((n) => normalizeNodeUrl(n.url));

/** True when the node URL matches a preset entry (normalized). */
export const isPresetNodeUrl = (node) =>
  PRESET_NODE_URLS.includes(normalizeNodeUrl(node));

/** True for DeFi / testnet nodes (wart_balance, Assets, DEX, etc.). */
export const isDefiNode = (node) => {
  const n = normalizeNodeUrl(node).toLowerCase();
  if (!n) return false;
  if (isPresetNodeUrl(n)) return true;
  if (n.includes('defitestnet') || n.includes('testnet')) return true;
  if (n.includes('localhost') || n.includes('127.0.0.1')) return true;
  if (n.includes(':3002')) return true;
  return false;
};

/**
 * Mainnet nodes use /account/:addr/balance; DeFi testnet nodes use /wart_balance.
 * None of the preset nodes are mainnet.
 */
export const isMainnetNode = (node) => !isDefiNode(node);