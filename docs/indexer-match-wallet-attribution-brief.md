# Indexer brief: wallet Matches tab is empty (match type attribution)

**To:** VPS / warthog-read-api (explorer indexer) maintainers  
**From:** WartBunker / bunker.warthog.network wallet  
**Topic:** `match` txs exist in the DB but never appear in per-wallet history  
**Priority:** UX bug for DeFi history — type/filter is fine; **address linking is missing**

---

## Summary

The wallet **Matches** tab correctly calls:

```http
GET /api/explorer/accounts/{addr}/transactions?group=match
```

(or `group=matches` / `type=match` — aliases are accepted.)

The API understands the filter. It still returns **zero rows for every address** because match rows are indexed with **empty `sender` / `recipient`**, and wallet history only selects rows where:

```sql
sender = %s  OR  recipient = %s
```

Matches are stored for **block / global explorer** views, not attached to traders. To make Matches useful on wallets, the **sync path must extract trader (or order-owner) addresses from the node `match[]` payload** and write them into `sender`/`recipient` (or an involvement table + query change), then **re-sync or backfill**.

---

## Confirmed: `match` is a first-class type

From indexer `read_api.py` (as documented / observed):

### Canonical types include

```text
reward, transfer, token_transfer, limit_swap, match, cancelation,
liquidity_deposit, liquidity_withdrawal, asset_creation
```

### Groups

```text
"match": ("match",)
```

### Aliases

```text
"match"   → "match"
"matches" → "match"
```

### Wallet filter options

| Client sends        | Server should treat as |
|---------------------|------------------------|
| `group=match`       | types: `match`         |
| `group=matches`     | types: `match`         |
| `type=match`        | type: `match`          |

Live check on DeFi testnet:

```bash
BASE="https://warthog-defitestnet.duckdns.org/api/explorer"

curl -sS "$BASE/meta/tx-types"
# includes "match" in types and groups.match

curl -sS "$BASE/health"
# ok + dbHeight
```

So this is **not** a missing type registration problem.

---

## Root cause: how matches are normalized on ingest

Current-style normalization (conceptual; match your codebase names):

```python
def _normalize_defi_match(entry: dict) -> dict:
    """Pool match settlement — no signedCommon; record for explorer only."""
    tx = entry.get("transaction") or entry
    return {
        "amount": "0",
        "amountE8": 0,
        "fee": "0",
        "feeE8": 0,
        "fromAddress": "",   # ← empty
        "toAddress": "",     # ← empty
        "nonceId": None,
        "pinHeight": None,
        "txHash": tx.get("hash") or "",
        "_kind": "match",
    }
```

Postgres ends up roughly:

| Column      | Typical match value |
|-------------|---------------------|
| `type`      | `'match'`           |
| `sender`    | `''` or NULL        |
| `recipient` | `''` or NULL        |

Wallet history:

```sql
WHERE sender = %s OR recipient = %s
```

→ **0 rows for any real address**, even when many `type = 'match'` rows exist globally.

Docs already note: match is often “no simple sender/recipient” and “history only (no balance delta).” That matches observed behavior.

---

## How the wallet queries this (WartBunker)

| Item | Value |
|------|--------|
| Indexer base (official DeFi) | `https://warthog-defitestnet.duckdns.org/api/explorer` |
| History (preferred) | Indexer account transactions |
| Fallback | Node `/account/{addr}/history` (only if no indexer) |
| Matches tab → API | `group=match` |
| Type map | indexer `match` → UI type `match` |

Relevant client mapping (for regression tests after the fix):

```text
UI filter "matches"  →  query { group: "match" }
UI filter "limit_swaps" → query { group: "limit_swap" }
```

Empty-state copy users see: *“No DEX matches found for this address.”* — accurate given current DB, not a client bug.

---

## Quick checks on the VPS / against the live API

```bash
BASE="https://warthog-defitestnet.duckdns.org/api/explorer"   # or local indexer base
ADDR="<48-hex wallet address>"

# 1) Type filter works; usually empty for any wallet today
curl -sS "$BASE/accounts/${ADDR}/transactions?group=match&includeTotal=1"
# expect: total: 0, transactions: []

# 2) Same for alias
curl -sS "$BASE/accounts/${ADDR}/transactions?group=matches&includeTotal=1"

# 3) DB (on the indexer host)
# SELECT COUNT(*) FROM txs WHERE type = 'match';
# SELECT COUNT(*) FROM txs WHERE type = 'match' AND (sender = '' OR sender IS NULL);
# SELECT COUNT(*) FROM txs WHERE type = 'match' AND sender <> '' AND sender IS NOT NULL;
#
# Typical today: many match rows globally; almost all with empty sender/recipient;
# zero rows for a given wallet address.
```

---

## Node payload shape (what sync should read)

On the node, matches live under block body (not as normal signed transfers):

```text
block.body.match[]   # array (key is singular "match")
```

WartBunker / chart code already treats entries roughly as:

```text
entry.transaction.data.baseAsset.hash
entry.transaction.data.baseAsset.name
entry.transaction.data.buySwaps[]
entry.transaction.data.sellSwaps[]
  swap.swapped.base
  swap.swapped.quote
```

There is often **no `signedCommon.fromAddress`** on the match itself (settlement, not a user-signed transfer). Trader addresses — if present — will be nested under **swap / order / account fields inside `buySwaps` / `sellSwaps`** (or related order ids that must be joined to prior `limit_swap` rows). Exact field names need one real non-empty `match[]` dump from a node block on this chain.

### Suggested investigation on VPS

1. Find a height with non-empty matches:

```bash
NODE="http://<defi-node>:3001"   # or https://warthog-defitestnet.duckdns.org
# page recent blocks until body.match is non-empty, then:
curl -sS "$NODE/block/<HEIGHT>" | jq '.data.body.match[0]'
```

2. Dump full keys under `buySwaps` / `sellSwaps` / order references.
3. Decide attribution rules (see below).
4. Patch `_normalize_defi_match` (or equivalent) + backfill.

---

## Requested indexer change

### Goal

Wallet:

```http
GET /accounts/{addr}/transactions?group=match
```

returns match settlements **involving that address**, with stable ordering consistent with other history (height/time desc).

### Minimum viable approach

For each node `match` entry, extract **all distinct involved addresses** (makers/takers/order owners — whatever the payload exposes). Then either:

**Option A — dual rows (simple for current SQL)**  
Insert one `txs` row per involved address (or two if you only support single sender + single recipient):

- e.g. `sender = traderA`, `recipient = traderB` when exactly two parties  
- or one row per trader with `sender = trader`, `recipient = ''` if the schema is asymmetric  

**Option B — involvement table (cleaner)**  
Keep one canonical match row; add `tx_parties(tx_hash, address, role)` and change account history to:

```sql
WHERE sender = %s OR recipient = %s
   OR EXISTS (SELECT 1 FROM tx_parties p WHERE p.tx_hash = txs.hash AND p.address = %s)
```

**Option C — join to limit_swap**  
If match payload only has order/tx ids, resolve owners from already-indexed `limit_swap` rows and write those addresses onto the match (or into `tx_parties`).

### Amount / fee fields

Matches are often “no balance delta” in the simple transfer sense. Still useful to store:

- human-readable base/quote notionals if available (`buySwaps`/`sellSwaps` legs)
- asset hash / symbol for explorer + wallet description  
- height, timestamp, tx hash  

Wallet currently displays something like: `DEX match {amount}` — any non-zero structured amount helps.

### Balance accounting

Do **not** double-count matches as WART transfers if balance is derived from history. Prefer:

- match rows: history / analytics only  
- balance still from node balance endpoints (as today)

### Backfill

After changing normalize:

1. Re-index from genesis **or** from first DeFi height that has `body.match`.
2. Or one-shot SQL/script: re-parse stored raw match JSON if you keep raw bodies; else re-walk node blocks for `type = match` only.
3. Verify:

```sql
SELECT COUNT(*) FROM txs WHERE type = 'match' AND COALESCE(sender, '') <> '';
```

```bash
curl -sS "$BASE/accounts/${KNOWN_TRADER}/transactions?group=match&includeTotal=1"
# total > 0 after that trader’s fills are backfilled
```

---

## Acceptance criteria

- [ ] `GET /meta/tx-types` still lists `match` (no regression).
- [ ] Global/block explorer still shows matches (even if multi-party).
- [ ] For an address that actually traded (had fills),  
  `GET /accounts/{addr}/transactions?group=match&includeTotal=1` → `total > 0`.
- [ ] Those rows include usable `hash`, `height`, `timestamp`, and preferably amount/asset metadata.
- [ ] `group=matches` alias still works.
- [ ] Non-traders still get `total: 0` (no false positives from empty-string matching).
- [ ] Empty string / NULL sender must **not** match every wallet (`WHERE sender = %s` with careful NULL/`''` handling).

---

## Non-goals / out of scope for this fix

- Changing wallet client filters (already correct).
- Renaming type from `match` to `matches` (alias is enough).
- Making match rows drive balance deltas (unless product explicitly wants that).

---

## Context for the wallet team (optional note)

- Pre-indexer, history came from node account pages and could surface `body.match` when present on those pages.
- Post-indexer, history is address-keyed only → empty Matches is expected until attribution lands.
- Limit swaps (user-signed) still show under `group=limit_swap`; users often confuse fills with “matches.”
- Charts already consume node `body.match` for prices; only **wallet-linked history** is missing.

---

## Contact / product intent

**Product intent:** Matches tab should list **DEX match settlements that involved this wallet**, not every global match.

Please implement address extraction + backfill on the indexer host, then notify so the wallet can re-test the Matches tab against official:

`https://warthog-defitestnet.duckdns.org/api/explorer`
