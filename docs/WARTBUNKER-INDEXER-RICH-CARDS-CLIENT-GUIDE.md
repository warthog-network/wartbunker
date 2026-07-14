# WartBunker client guide: rich indexer cards + Matches tab

**From:** DeFi indexer VPS (`warthog-defitestnet` / warthog-read-api)  
**To:** WartBunker wallet (`bunker.warthog.network`) developers  
**Date:** 2026-07-14  
**Status:** Indexer work is **done and live**. This doc is the remaining **wallet** work.

Copy this file to your laptop, then implement in the WartBunker repo.

```bash
# From your machine (adjust user/host if needed):
scp root@217.216.94.146:/root/WARTBUNKER-INDEXER-RICH-CARDS-CLIENT-GUIDE.md ./
# Optional: also grab the server-side briefs for context
scp root@217.216.94.146:/root/indexer-defi-tx-detail-guide.md ./
scp root@217.216.94.146:/root/indexer-match-wallet-attribution-brief.md ./
```

---

## 1. What already shipped on the indexer

Public base (official DeFi testnet explorer API):

```text
https://warthog-defitestnet.duckdns.org/api/explorer
```

| Feature | Status |
|---------|--------|
| Type / group filters (`group=match`, `group=limit_swap`, …) | Done |
| Match → wallet attribution (`sender`/`recipient` from swap `historyId`) | Done + backfilled |
| Rich `meta` on DeFi txs (limit_swap, match, liquidity, cancel, token, asset) | Done + backfilled |
| Account history, block list, `GET /transactions/{hash}` all return `meta` | Done |

**You no longer need to call the node `getBlock(height)` to hydrate limit swaps / matches for recent history.** Prefer indexer `meta`; keep node hydrate only as a fallback for ancient rows without `meta`.

### Smoke checks (from anywhere)

```bash
BASE="https://warthog-defitestnet.duckdns.org/api/explorer"
ADDR="56ed966df64571675f38be3b4219862dbbec8f0e69140de3"
HASH_LS="8bd387e5c94c0ce4ad12f23c3e676e8c9fe6902b97057e3ee152437bf51cfa6d"
HASH_M="b3f14bb8a9fd9a0548c434c0654ac911e0db526c35dd324654cd31323655f824"

curl -sS "$BASE/health"
curl -sS "$BASE/meta/tx-types"
curl -sS "$BASE/transactions/$HASH_LS" | jq '.data.meta'
curl -sS "$BASE/transactions/$HASH_M" | jq '.data.meta'
curl -sS "$BASE/accounts/$ADDR/transactions?group=match&includeTotal=1&count=2" | jq .
curl -sS "$BASE/accounts/$ADDR/transactions?group=limit_swap&count=1" | jq '.data.transactions[0]'
```

Expected:

- `meta.side`, `order_amount`, `asset_name=MHJ`, `limit_price`, `summary` on limit_swap  
- `meta.base_amount`, `quote_amount`, `swap_count`, `asset_name`, `summary` on match  
- `group=match` → `total > 0` for that address  

---

## 2. API contract (wallet-facing)

### 2.1 Unchanged base fields

Every tx still has:

```text
type, hash, amount, fee, nonce, pinHeight, height, sender, recipient, timestamp
direction   # only on account history routes
```

Do **not** break consumers that ignore unknown keys.

### 2.2 New optional object: `meta`

Present when non-empty (omitted or `{}` for plain rewards/transfers).

#### `limit_swap`

```json
{
  "type": "limit_swap",
  "amount": "0.00000000",
  "fee": "0.01000448",
  "sender": "56ed…",
  "meta": {
    "side": "buy",
    "order_amount": "12.00000000",
    "asset_name": "MHJ",
    "asset_hash": "30b1e5958e46cd7c0fd50bcbe1d5d1d5406eb87a3907a6d1936245adf1527389",
    "asset_decimals": 8,
    "asset_id": 21,
    "limit_price": "8.999928832054138e-05",
    "summary": "BUY limit 12.00000000 WART for MHJ @ 8.999928832054138e-05",
    "history_id": 123324
  }
}
```

Notes:

- `amount` is **0** on purpose (not a WART balance transfer). Use `meta.order_amount` for card size.  
- Buy: size is **WART**. Sell: size is **base asset** (`asset_name`).  
- `side` is `"buy"` | `"sell"`.

#### `match`

```json
{
  "type": "match",
  "amount": "12.00000000",
  "sender": "56ed…",
  "recipient": "",
  "meta": {
    "asset_name": "MHJ",
    "asset_hash": "30b1e595…",
    "asset_decimals": 8,
    "base_amount": "143576.16129472",
    "quote_amount": "12.00000000",
    "swap_count": 1,
    "summary": "DEX match (1 swap) on MHJ — 143576.16129472 MHJ / 12.00000000 WART",
    "parties": ["56ed…"],
    "history_ids": [123324],
    "history_id": 123325
  }
}
```

Notes:

- `amount` ≈ quote notional in WART (backward compatible display).  
- Prefer `meta.summary` or `base_amount` / `quote_amount` for richer cards.  
- Wallet filter still uses `sender` / `recipient` (attribution is fixed on the server).

#### Other DeFi types (same pattern)

| type | Useful meta keys |
|------|------------------|
| `liquidity_deposit` / `liquidity_withdrawal` | `asset_name`, `asset_hash`, `base_amount`, `quote_amount`, `shares`, `summary` |
| `cancelation` | `cancel_txid`, `summary` |
| `token_transfer` | `asset_name`, `asset_hash`, `token_amount`, `summary` |
| `asset_creation` | `asset_name`, `supply`, `summary` |

### 2.3 Filters (unchanged; already correct in wallet)

| UI tab / filter | Query |
|-----------------|--------|
| Matches | `group=match` (alias `group=matches` also works) |
| Limit swaps | `group=limit_swap` |
| Liquidity | `group=liquidity` |
| Transfers | `group=transfer` |

Example:

```http
GET /api/explorer/accounts/{addr}/transactions?group=match&includeTotal=1&count=25&page=1
```

---

## 3. Files to touch in WartBunker

Exact paths may vary slightly by branch; search for these names:

| Area | Likely path |
|------|-------------|
| Indexer client / normalize | `src/utils/warthogIndexer.js` (or `.ts`) |
| History cache / enrich | `src/utils/accountHistoryCache.js` |
| Tx card / list row UI | components that render history rows (search `DEX match`, `Limit order`, `limit_swap`, `group=match`) |
| Type map | wherever indexer `type` → UI type is mapped |

```bash
# In WartBunker repo root:
rg -n "warthogIndexer|normalizeIndexer|group=match|limit_swap|getBlock|hydrate" src/
rg -n "No DEX matches|Limit order placed|DEX match" src/
```

---

## 4. Normalization: map `meta` → card model

### 4.1 Preferred display fields

Stable contract for the UI layer:

```text
tx.meta.summary          → description (preferred, ready-made string)
tx.meta.asset_name       → asset ticker (display label)
tx.meta.asset_hash       → asset id (copy on click; never show full hash as primary label)
tx.meta.order_amount     → amount line for limit_swap when amount is 0
tx.meta.base_amount      → match base leg
tx.meta.quote_amount     → match quote / WART leg
tx.meta.side             → buy | sell
tx.meta.limit_price      → limit price
tx.meta.swap_count       → match legs count
```

### 4.2 Example normalizer (adapt to your codebase)

```js
/**
 * Enrich a sparse indexer tx with display fields for history cards.
 * Call this inside normalizeIndexerTransaction (or equivalent).
 */
export function applyIndexerMeta(tx) {
  const meta = tx.meta && typeof tx.meta === 'object' ? tx.meta : null;
  if (!meta) return tx;

  const out = { ...tx };

  // Ready-made one-liner for the card
  if (meta.summary) {
    out.description = meta.summary;
    out.summary = meta.summary;
  }

  // Asset: show ticker, keep hash for copy / deep links
  if (meta.asset_name) out.assetName = meta.asset_name;
  if (meta.asset_hash) out.assetHash = meta.asset_hash;
  if (meta.asset_decimals != null) out.assetDecimals = meta.asset_decimals;

  // Type-specific amounts
  if (tx.type === 'limit_swap' || out.uiType === 'limit_swap') {
    out.side = meta.side; // 'buy' | 'sell'
    out.orderAmount = meta.order_amount;
    out.limitPrice = meta.limit_price;
    // Card amount: prefer order size over balance-delta 0
    if (meta.order_amount && (tx.amount === '0' || tx.amount === '0.00000000' || !Number(tx.amount))) {
      out.displayAmount = meta.order_amount;
      out.displayAmountUnit = meta.side === 'sell' ? (meta.asset_name || 'ASSET') : 'WART';
    }
  }

  if (tx.type === 'match' || out.uiType === 'match') {
    out.baseAmount = meta.base_amount;
    out.quoteAmount = meta.quote_amount;
    out.swapCount = meta.swap_count;
    // Optional dual-line amount
    if (meta.base_amount && meta.quote_amount && meta.asset_name) {
      out.displayAmount = meta.base_amount;
      out.displayAmountUnit = meta.asset_name;
      out.displayAmountSecondary = `${meta.quote_amount} WART`;
    }
  }

  // Mark as fully hydrated so node getBlock path is skipped
  out.richFromIndexer = true;
  return out;
}
```

Wire it in:

```js
export function normalizeIndexerTransaction(raw, address) {
  let tx = /* existing mapping of type/hash/amount/fee/sender/... */;
  tx = applyIndexerMeta(tx);
  return tx;
}
```

### 4.3 Demote node hydration

In `accountHistoryCache` (or wherever you call `getBlock(height)` for sparse types):

```js
function needsNodeHydration(tx) {
  // New path: indexer already gave summary + asset
  if (tx.richFromIndexer || tx.meta?.summary) return false;
  // Old sparse rows only
  const sparse = ['limit_swap', 'match', 'liquidity_deposit', 'liquidity_withdrawal', 'cancelation'];
  return sparse.includes(tx.type) && !tx.meta?.asset_name;
}
```

Keep hydrate as **fallback** for any row still missing `meta` (should be rare after backfill).

---

## 5. UI: show ticker, copy hash on click

**Requirement:** list the **ticker** (`asset_name`), not the asset hash.  
When the user clicks (or long-presses) the asset chip, **copy the hash** (`asset_hash`).

### 5.1 React / simple example

```jsx
function AssetChip({ name, hash }) {
  const label = name || (hash ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : '—');
  const copyValue = hash || name || '';

  async function onClick(e) {
    e.stopPropagation(); // don't open tx detail if nested in a row
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
      // toast(`Copied ${name || 'asset id'}`);
    } catch {
      // fallback: prompt / legacy copy
    }
  }

  return (
    <button
      type="button"
      className="asset-chip"
      title={hash ? `Copy asset id: ${hash}` : label}
      onClick={onClick}
      aria-label={hash ? `Asset ${label}, click to copy id` : `Asset ${label}`}
    >
      {label}
    </button>
  );
}

// Usage on a history card:
// <AssetChip name={tx.assetName || tx.meta?.asset_name} hash={tx.assetHash || tx.meta?.asset_hash} />
```

### 5.2 UX rules

| Element | Show | Copy |
|---------|------|------|
| Asset chip / badge | `MHJ` (ticker) | full `asset_hash` |
| Card title / description | `meta.summary` if present | — |
| Limit amount | `order_amount` + unit (WART or ticker) | — |
| Match amount | `base_amount ticker` / `quote_amount WART` | — |
| Tx hash (separate control) | shortened `ab12…cd34` | full tx `hash` |

Do **not** use `asset_hash` as the primary visible label when `asset_name` exists.

### 5.3 CSS hint (optional)

```css
.asset-chip {
  cursor: copy;
  font-weight: 600;
  border: none;
  background: transparent;
  /* match your design system */
}
.asset-chip:hover { text-decoration: underline; }
```

---

## 6. Card copy targets (parity with old node history)

| Type | Old node-style string | Use now |
|------|----------------------|---------|
| limit_swap buy | `BUY limit 12 WART for MHJ @ 8.99e-05` | `meta.summary` |
| limit_swap sell | `SELL limit … MHJ @ …` | `meta.summary` |
| match | `DEX match (1 swap) on MHJ — 143576 MHJ / 12 WART` | `meta.summary` |

If `meta.summary` is missing, rebuild client-side:

```js
function buildLimitSummary(meta) {
  if (!meta) return 'Limit order placed';
  if (meta.side === 'buy') {
    return `BUY limit ${meta.order_amount} WART for ${meta.asset_name || 'ASSET'} @ ${meta.limit_price}`;
  }
  return `SELL limit ${meta.order_amount} ${meta.asset_name || 'ASSET'} @ ${meta.limit_price}`;
}

function buildMatchSummary(meta) {
  if (!meta) return 'DEX match';
  const n = meta.swap_count ?? 0;
  const asset = meta.asset_name || 'ASSET';
  let s = `DEX match (${n} swap${n === 1 ? '' : 's'}) on ${asset}`;
  if (meta.base_amount && meta.quote_amount) {
    s += ` — ${meta.base_amount} ${asset} / ${meta.quote_amount} WART`;
  }
  return s;
}
```

---

## 7. Matches tab

### 7.1 Query (already correct)

```js
// Matches tab
fetchIndexerAccountTxs(address, { group: 'match', includeTotal: 1, count: 25 });

// Do NOT use type names the server doesn't understand.
// Aliases accepted: group=match | group=matches | type=match
```

### 7.2 Empty state

Previously empty for **everyone** because matches had empty `sender`/`recipient`. That is fixed server-side.

Empty state *“No DEX matches found for this address.”* should only show when:

```text
total === 0  OR  transactions.length === 0
```

for an address that truly never got fills — not because of missing attribution.

### 7.3 Regression checklist

- [ ] Address with known fills (e.g. sample `56ed966d…40de3`) → Matches tab `total > 0`  
- [ ] Each row has usable `hash`, `height`, `timestamp`, and preferably `meta.summary`  
- [ ] Random unused address → still `total: 0`  
- [ ] Limit swaps tab still lists orders with rich summary (not only “Limit order placed” + amount 0)

---

## 8. Balance accounting (do not change)

Indexer history is **not** the balance source of truth.

- Balances: node balance endpoints (as today).  
- `match` rows: history / analytics only (no WART balance delta).  
- `limit_swap` `amount` is 0; fees may still appear as fee fields.  
- Do **not** double-count `meta.order_amount` / match legs into wallet balance math.

---

## 9. Suggested PR breakdown (wallet)

1. **Normalize `meta`** in `warthogIndexer.js` → `description`, `assetName`, `assetHash`, amounts.  
2. **Skip node hydrate** when `meta.summary` or `asset_name` present.  
3. **AssetChip UI**: ticker visible, copy `asset_hash` on click.  
4. **Card amount line**: `order_amount` / base+quote instead of bare `0`.  
5. **Manual QA** against public indexer base + sample address/hashes above.  
6. (Optional) Remove or feature-flag heavy node hydrate after soak.

---

## 10. Sample fixtures for unit tests

Use live samples or freeze these:

```js
const LIMIT_SWAP_FIXTURE = {
  type: 'limit_swap',
  amount: '0.00000000',
  fee: '0.01000448',
  hash: '8bd387e5c94c0ce4ad12f23c3e676e8c9fe6902b97057e3ee152437bf51cfa6d',
  height: 122994,
  sender: '56ed966df64571675f38be3b4219862dbbec8f0e69140de3',
  recipient: '',
  meta: {
    side: 'buy',
    order_amount: '12.00000000',
    asset_name: 'MHJ',
    asset_hash: '30b1e5958e46cd7c0fd50bcbe1d5d1d5406eb87a3907a6d1936245adf1527389',
    limit_price: '8.999928832054138e-05',
    summary: 'BUY limit 12.00000000 WART for MHJ @ 8.999928832054138e-05',
  },
};

const MATCH_FIXTURE = {
  type: 'match',
  amount: '12.00000000',
  hash: 'b3f14bb8a9fd9a0548c434c0654ac911e0db526c35dd324654cd31323655f824',
  height: 122994,
  sender: '56ed966df64571675f38be3b4219862dbbec8f0e69140de3',
  meta: {
    asset_name: 'MHJ',
    asset_hash: '30b1e5958e46cd7c0fd50bcbe1d5d1d5406eb87a3907a6d1936245adf1527389',
    base_amount: '143576.16129472',
    quote_amount: '12.00000000',
    swap_count: 1,
    summary: 'DEX match (1 swap) on MHJ — 143576.16129472 MHJ / 12.00000000 WART',
  },
};
```

Assert:

- description starts with `BUY limit` / `DEX match`  
- `assetName === 'MHJ'`  
- clipboard / copy helper receives full `asset_hash`  
- `needsNodeHydration(normalized) === false`

---

## 11. Config

Ensure production / DeFi testnet wallet points at:

```text
INDEXER_BASE=https://warthog-defitestnet.duckdns.org/api/explorer
```

(or your existing env key for the official explorer indexer). Node URL remains for balances, submit, and hydrate fallback only.

---

## 12. Acceptance criteria (wallet)

- [ ] Limit swap cards show buy/sell, size, ticker, limit price (or full `meta.summary`).  
- [ ] Match cards show asset + base/quote legs (or `meta.summary`).  
- [ ] Asset UI shows **ticker**; click copies **asset hash**.  
- [ ] Matches tab non-empty for addresses that actually traded.  
- [ ] History loads without N node `getBlock` calls per page when `meta` is present.  
- [ ] Balances unchanged (still from node).  
- [ ] Old clients / ignored `meta` still work (backward compatible API).

---

## 13. Copy commands (recap)

```bash
# On your laptop
scp root@217.216.94.146:/root/WARTBUNKER-INDEXER-RICH-CARDS-CLIENT-GUIDE.md ./docs/
# optional server-side context
scp root@217.216.94.146:/root/indexer-defi-tx-detail-guide.md ./docs/
scp root@217.216.94.146:/root/indexer-match-wallet-attribution-brief.md ./docs/
```

Or pull via curl if scp is awkward:

```bash
ssh root@217.216.94.146 'cat /root/WARTBUNKER-INDEXER-RICH-CARDS-CLIENT-GUIDE.md' > WARTBUNKER-INDEXER-RICH-CARDS-CLIENT-GUIDE.md
```

---

## 14. Contact / product intent

**Intent:** Wallet DeFi history cards should be as informative as when history came from the node, while list/filter stays on the indexer. Show **tickers**; copy **hashes**. Matches tab lists fills for **this** wallet only.

Indexer side is complete on the DeFi testnet VPS. Remaining work is WartBunker normalize + card UI only.
