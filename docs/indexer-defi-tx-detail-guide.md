# Indexer guide: rich DeFi history fields (limit swaps, matches, liquidity)

**Host:** indexer VPS (`root@217.216.94.146`) — warthog-read-api / explorer indexer  
**Product:** WartBunker wallet (`bunker.warthog.network`) + DeFi testnet explorer  
**Public base (example):** `https://warthog-defitestnet.duckdns.org/api/explorer`  
**Related brief:** `docs/indexer-match-wallet-attribution-brief.md` (match → wallet address linking)  
**Date:** 2026-07-14  

---

## 1. Why this guide exists

The wallet switched account history from **node** `/account/{addr}/history` to the **explorer indexer**.

Filters and pagination are good. **Card detail is not.**

| Source | Limit swap card | Match card |
|--------|-----------------|------------|
| **Node history (old)** | `BUY limit 12 WART for MHJ @ 8.99e-05` | `DEX match (1 swap) on MHJ — 143576 MHJ / 12 WART` |
| **Indexer list (today)** | `Limit order placed` / amount `0` | `DEX match 12.00000000 WART` (no asset, no legs) |

Root cause: ingest normalizes DeFi txs down to the transfer-shaped columns only:

```text
hash, height, timestamp, type, sender, recipient, amount, fee, nonce, pinHeight
```

The node payload still has buy/sell, limit price, asset name/hash, and swap legs. Those fields are **dropped at index time**.

The wallet currently **hydrates** sparse rows by calling the node `getBlock(height)` and re-parsing `body.limitSwap` / `body.match`. That works but:

- doubles load on the node  
- is fragile under 502s  
- is slow when many unique heights appear on a page  

**Goal for the indexer:** store and return enough structured fields that the wallet can render rich cards **from the indexer alone**.

---

## 2. Live API: what the indexer returns today

### 2.1 Canonical types / groups (already correct)

```bash
BASE="https://warthog-defitestnet.duckdns.org/api/explorer"   # or http://127.0.0.1:<port>
curl -sS "$BASE/meta/tx-types"
curl -sS "$BASE/health"
```

Types include:

```text
reward, transfer, token_transfer, limit_swap, match, cancelation,
liquidity_deposit, liquidity_withdrawal, asset_creation
```

Groups: `limit_swap`, `match`, `liquidity`, `transfer`, `reward`, …

### 2.2 Sparse list row (limit_swap) — production sample

`GET /accounts/56ed966df64571675f38be3b4219862dbbec8f0e69140de3/transactions?group=limit_swap&count=1`

```json
{
  "amount": "0.00000000",
  "direction": "out",
  "fee": "0.01000448",
  "hash": "8bd387e5c94c0ce4ad12f23c3e676e8c9fe6902b97057e3ee152437bf51cfa6d",
  "height": 122994,
  "nonce": 3,
  "pinHeight": 122976,
  "recipient": "",
  "sender": "56ed966df64571675f38be3b4219862dbbec8f0e69140de3",
  "timestamp": 1784031756,
  "type": "limit_swap"
}
```

Problems for the wallet:

- `amount` is always `0` for open/signed limit orders (no simple balance delta)  
- no asset symbol/hash  
- no buy vs sell  
- no limit price  

### 2.3 Sparse list row (match) — same height

```json
{
  "amount": "12.00000000",
  "direction": "out",
  "fee": "0.00000000",
  "hash": "b3f14bb8a9fd9a0548c434c0654ac911e0db526c35dd324654cd31323655f824",
  "height": 122994,
  "sender": "56ed966df64571675f38be3b4219862dbbec8f0e69140de3",
  "recipient": "",
  "type": "match"
}
```

`amount` is useful (often quote/WART notional) but still missing asset + base/quote legs + swap count.

### 2.4 Block endpoint is equally sparse

`GET /blocks/122994` → `data.transactions[]` uses the **same flat columns**. Detail is not stored anywhere the API can return.

---

## 3. Node payload: what ingest must read

Node path that works on DeFi testnet (history often 502s; **block by height is reliable**):

```bash
NODE="https://warthog-defitestnet.duckdns.org"   # or local node URL on the VPS
HEIGHT=122994

# Prefer the path your node exposes; one of:
curl -sS "$NODE/chain/block/$HEIGHT" | jq .
# or: curl -sS "$NODE/block/$HEIGHT" | jq .
```

### 3.1 `body.limitSwap[]` — full sample (height 122994)

```json
{
  "transaction": {
    "data": {
      "baseAsset": {
        "hash": "30b1e5958e46cd7c0fd50bcbe1d5d1d5406eb87a3907a6d1936245adf1527389",
        "id": 21,
        "name": "MHJ",
        "decimals": 8
      },
      "amount": {
        "str": "12.00000000",
        "u64": 1200000000,
        "decimals": 8
      },
      "limit": {
        "precExponent10": 0,
        "exponent2": -29,
        "mantissa": 48318,
        "hex": "bcbe32",
        "doubleAdjusted": 8.999928832054138e-05,
        "doubleRaw": 8.999928832054138e-05
      },
      "buy": true
    },
    "processed": {
      "remaining": { "str": "", "u64": 4, "decimals": 237250656 }
    },
    "hash": "8bd387e5c94c0ce4ad12f23c3e676e8c9fe6902b97057e3ee152437bf51cfa6d",
    "signedCommon": {
      "originId": 6,
      "originAddress": "56ed966df64571675f38be3b4219862dbbec8f0e69140de3",
      "fee": { "str": "0.01000448", "E8": 1000448 },
      "nonceId": 3,
      "pinHeight": 122976
    }
  },
  "historyId": 123324
}
```

**Field mapping (limit_swap):**

| Node path | Meaning | Suggested stored field |
|-----------|---------|------------------------|
| `transaction.hash` | Tx id | `hash` (existing) |
| `signedCommon.originAddress` | Order owner | `sender` (existing) |
| `signedCommon.fee` | Fee WART | `fee` (existing) |
| `signedCommon.nonceId` | Nonce | `nonce` (existing) |
| `signedCommon.pinHeight` | Pin height | `pinHeight` (existing) |
| `data.buy` | true = spend WART for asset | **`side`**: `"buy"` / `"sell"` |
| `data.amount.str` | Order size | **`order_amount`** (string decimal) |
| `data.baseAsset.name` | Symbol | **`asset_name`** |
| `data.baseAsset.hash` | Asset id | **`asset_hash`** |
| `data.baseAsset.decimals` | Decimals | **`asset_decimals`** |
| `data.limit.doubleAdjusted` | Limit price | **`limit_price`** (float or string) |
| — | Human summary for UIs | **`summary`** or build client-side |

**Semantics of `amount` on limit_swap:**

- Do **not** force transfer-style `amount = order size` if that confuses balance accounting.  
- Prefer keeping `amount` as balance-delta (`0` for orders is OK) **and** add `order_amount` + metadata.  
- If you must reuse `amount`, set it to order size **and** document that limit_swap amounts are not balance deltas.

**Wallet description target (limit_swap):**

```text
BUY limit {order_amount} WART for {asset_name} @ {limit_price}
SELL limit {order_amount} {asset_name} @ {limit_price}
```

(buy → size is WART; sell → size is base asset.)

### 3.2 `body.match[]` — full sample (same height)

```json
{
  "transaction": {
    "data": {
      "baseAsset": {
        "hash": "30b1e5958e46cd7c0fd50bcbe1d5d1d5406eb87a3907a6d1936245adf1527389",
        "id": 21,
        "name": "MHJ",
        "decimals": 8
      },
      "poolBefore": { "base": { "str": "..." }, "quote": { "str": "..." } },
      "poolAfter":  { "base": { "str": "..." }, "quote": { "str": "..." } },
      "buySwaps": [
        {
          "swapped": {
            "base":  { "str": "143576.16129472", "u64": 14357616129472, "decimals": 8 },
            "quote": { "str": "12.00000000", "E8": 1200000000 }
          },
          "historyId": 123324
        }
      ],
      "sellSwaps": []
    },
    "hash": "b3f14bb8a9fd9a0548c434c0654ac911e0db526c35dd324654cd31323655f824"
  },
  "historyId": 123325
}
```

**Field mapping (match):**

| Node path | Suggested stored field |
|-----------|------------------------|
| sum/all of `buySwaps`+`sellSwaps` `.swapped.base.str` | `base_amount` |
| sum/all of `.swapped.quote.str` / E8 | `quote_amount` (WART) |
| `baseAsset.name` / `hash` / `decimals` | `asset_name`, `asset_hash`, `asset_decimals` |
| `len(buySwaps)+len(sellSwaps)` | `swap_count` |
| join of order owners (see §5) | `sender` / `recipient` / parties table |
| existing | `amount` ← prefer **quote_amount** for backward compat (what you already store as `"12.00000000"`) |

**Wallet description target (match):**

```text
DEX match ({swap_count} swap(s)) on {asset_name} — {base_amount} {asset_name} / {quote_amount} WART
```

### 3.3 Other DeFi types (same treatment)

| Node body key | Type | Extra fields to keep |
|---------------|------|----------------------|
| `liquidityDeposit` | `liquidity_deposit` | asset name/hash, deposited base+quote, shares received |
| `liquidityWithdrawal` | `liquidity_withdrawal` | asset, shares redeemed, base+quote received |
| `cancelation` | `cancelation` | `cancel_txid` of canceled order |
| `tokenTransfer` | `token_transfer` | asset name/hash, amount, to/from |
| `assetCreation` | `asset_creation` | name, supply, creator |

---

## 4. Recommended schema change

### 4.1 Option A — JSONB `meta` column (recommended)

Minimal migration, flexible for all DeFi types:

```sql
-- name example; adapt to your real table
ALTER TABLE txs
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS txs_meta_asset_hash_idx
  ON txs ((meta->>'asset_hash'))
  WHERE meta ? 'asset_hash';
```

**Example `meta` for limit_swap:**

```json
{
  "side": "buy",
  "order_amount": "12.00000000",
  "asset_name": "MHJ",
  "asset_hash": "30b1e5958e46cd7c0fd50bcbe1d5d1d5406eb87a3907a6d1936245adf1527389",
  "asset_decimals": 8,
  "limit_price": "0.00008999928832054138",
  "summary": "BUY limit 12.00000000 WART for MHJ @ 0.00008999928832054138"
}
```

**Example `meta` for match:**

```json
{
  "asset_name": "MHJ",
  "asset_hash": "30b1e5958e46cd7c0fd50bcbe1d5d1d5406eb87a3907a6d1936245adf1527389",
  "asset_decimals": 8,
  "base_amount": "143576.16129472",
  "quote_amount": "12.00000000",
  "swap_count": 1,
  "summary": "DEX match (1 swap) on MHJ — 143576.16129472 MHJ / 12.00000000 WART",
  "parties": [
    "56ed966df64571675f38be3b4219862dbbec8f0e69140de3"
  ]
}
```

### 4.2 Option B — flat columns

Only if you want strict typing / no JSON:

```sql
ALTER TABLE txs
  ADD COLUMN asset_name TEXT,
  ADD COLUMN asset_hash TEXT,
  ADD COLUMN side TEXT,              -- buy|sell for limit_swap
  ADD COLUMN order_amount TEXT,
  ADD COLUMN limit_price TEXT,
  ADD COLUMN base_amount TEXT,
  ADD COLUMN quote_amount TEXT,
  ADD COLUMN swap_count INT,
  ADD COLUMN summary TEXT;
```

JSONB is preferred: one column covers liquidity/cancel/token details without more migrations.

### 4.3 API response shape (read path)

Extend each transaction object (list + by-hash + block list) with either:

**Preferred (explicit, wallet-friendly):**

```json
{
  "hash": "…",
  "type": "limit_swap",
  "amount": "0.00000000",
  "fee": "0.01000448",
  "sender": "…",
  "recipient": "",
  "height": 122994,
  "timestamp": 1784031756,
  "direction": "out",
  "meta": {
    "side": "buy",
    "order_amount": "12.00000000",
    "asset_name": "MHJ",
    "asset_hash": "30b1…",
    "limit_price": "8.9999e-05",
    "summary": "BUY limit 12.00000000 WART for MHJ @ …"
  }
}
```

Or flatten top-level (also fine):

```json
{
  "type": "limit_swap",
  "side": "buy",
  "orderAmount": "12.00000000",
  "assetName": "MHJ",
  "assetHash": "30b1…",
  "limitPrice": "…",
  "summary": "…"
}
```

**Rules:**

- Always include `meta` / extra fields when non-empty; omit or `{}` for rewards/transfers if unused.  
- Do not break existing keys (`type`, `amount`, `fee`, `sender`, `recipient`, `hash`, `height`, `timestamp`, `direction`).  
- Wallet will prefer `meta.summary` when present; else build from structured fields.

---

## 5. Match address attribution (still required for Matches tab completeness)

Even with rich `meta`, history is filtered by:

```sql
WHERE sender = $addr OR recipient = $addr
-- (plus direction filters)
```

If many global `match` rows still have empty `sender`/`recipient`, some wallets will miss fills.

**Observed on height 122994:** the match row *does* have `sender` set to the limit-swap origin (likely because `buySwaps[].historyId` joins to the limit_swap). That may already work for **takers** who also placed the order in-block. Confirm for:

- multi-party matches  
- fills of **resting** book orders (maker only)  
- sell-side fills  

### Attribution strategy (pick one)

**A. Dual/multi rows** — one `txs` row per involved address (same hash, different sender).  
**B. `tx_parties(tx_hash, address, role)`** — query history via JOIN/EXISTS.  
**C. Join `buySwaps`/`sellSwaps` `historyId` → prior `limit_swap` row → `originAddress`.**

For height 122994, `buySwaps[0].historyId == 123324` equals the limit_swap’s `historyId` — **C is proven on this chain**.

```text
match.buySwaps[].historyId  →  limit_swap.historyId  →  signedCommon.originAddress
```

Also walk `sellSwaps` the same way. Collect distinct addresses → parties.

Details and acceptance tests: see `indexer-match-wallet-attribution-brief.md`.

---

## 6. Ingest / normalize code changes (conceptual)

Locate the function that turns a node block body into DB rows (names vary: `_normalize_defi_*`, `index_block`, `sync_height`, …).

### 6.1 limit_swap

```python
def normalize_limit_swap(entry: dict) -> dict:
    tx = entry.get("transaction") or entry
    data = tx.get("data") or {}
    common = tx.get("signedCommon") or {}
    base = data.get("baseAsset") or {}
    amount = data.get("amount") or {}
    limit = data.get("limit") or {}
    buy = bool(data.get("buy"))
    order_amount = amount.get("str") or "0"
    asset_name = base.get("name") or "ASSET"
    limit_price = limit.get("doubleAdjusted")
    if limit_price is None:
        limit_price = limit.get("doubleRaw")
    side = "buy" if buy else "sell"
    if buy:
        summary = f"BUY limit {order_amount} WART for {asset_name} @ {limit_price}"
    else:
        summary = f"SELL limit {order_amount} {asset_name} @ {limit_price}"

    fee = (common.get("fee") or {}).get("str") or "0"
    return {
        "type": "limit_swap",
        "hash": tx.get("hash") or "",
        "sender": common.get("originAddress") or "",
        "recipient": "",
        "amount": "0",              # not a balance transfer
        "fee": fee,
        "nonce": common.get("nonceId"),
        "pinHeight": common.get("pinHeight"),
        "meta": {
            "side": side,
            "order_amount": str(order_amount),
            "asset_name": asset_name,
            "asset_hash": base.get("hash") or "",
            "asset_decimals": base.get("decimals"),
            "limit_price": str(limit_price) if limit_price is not None else None,
            "summary": summary,
        },
    }
```

### 6.2 match

```python
def _leg_sum(swaps, leg):
    # sum swapped.base / swapped.quote str or raw units
    ...

def normalize_match(entry: dict, history_id_to_owner: dict) -> dict:
    tx = entry.get("transaction") or entry
    data = tx.get("data") or {}
    base = data.get("baseAsset") or {}
    buy_swaps = data.get("buySwaps") or []
    sell_swaps = data.get("sellSwaps") or []
    all_swaps = buy_swaps + sell_swaps
    base_amt = _leg_sum(all_swaps, "base")
    quote_amt = _leg_sum(all_swaps, "quote")
    asset_name = base.get("name") or "ASSET"
    n = len(all_swaps)
    summary = f"DEX match ({n} swap{'s' if n != 1 else ''}) on {asset_name}"
    if base_amt and quote_amt:
        summary += f" — {base_amt} {asset_name} / {quote_amt} WART"

    parties = []
    for s in all_swaps:
        hid = s.get("historyId")
        owner = history_id_to_owner.get(hid)
        if owner:
            parties.append(owner)
    parties = sorted(set(parties))

    # Option A: one row per party, or set sender=parties[0], recipient=parties[1]
    sender = parties[0] if parties else ""
    recipient = parties[1] if len(parties) > 1 else ""

    return {
        "type": "match",
        "hash": tx.get("hash") or "",
        "sender": sender,
        "recipient": recipient,
        "amount": quote_amt or "0",
        "fee": "0",
        "meta": {
            "asset_name": asset_name,
            "asset_hash": base.get("hash") or "",
            "asset_decimals": base.get("decimals"),
            "base_amount": base_amt,
            "quote_amount": quote_amt,
            "swap_count": n,
            "summary": summary,
            "parties": parties,
            "history_ids": [s.get("historyId") for s in all_swaps],
        },
    }
```

Build `history_id_to_owner` while indexing the same block’s `limitSwap` entries:

```python
history_id_to_owner[entry["historyId"]] = originAddress
```

If the match references an older open order, resolve from DB:

```sql
SELECT sender FROM txs WHERE type = 'limit_swap' AND meta->>'history_id' = $1
-- or a dedicated history_id column if you store it
```

Storing `history_id` on limit_swap rows makes join **C** reliable across blocks.

### 6.3 liquidity / cancel / token (brief)

Same pattern: extract human decimals from `.str` / E8 / u64+decimals, put structured fields + `summary` in `meta`.

---

## 7. Backfill plan (on the VPS)

### 7.1 Preconditions

```bash
ssh root@217.216.94.146
# locate service, code, env
systemctl list-units | grep -iE 'warthog|indexer|read'
# typical layout (adjust to reality):
# /opt/warthog-read-api  or  /root/warthog-read-api  or docker compose
```

Confirm:

- Postgres (or whatever) DB name/credentials  
- Node URL used by the indexer (`WARTHOG_RPC`, etc.)  
- Sync process vs read API (may be two processes)

### 7.2 Deploy code + migration

1. Add `meta` column (or flat columns).  
2. Deploy updated normalize + API serialization.  
3. Restart sync + read API.  
4. Smoke-test new blocks only first (tip advances, new limit_swaps have non-empty `meta`).

### 7.3 Historical backfill options

**Option 1 — re-index DeFi range** (simplest correctness):

```bash
# Pseudocode — use your real CLI
./indexer reindex --from-height <first-defi-height> --types limit_swap,match,liquidity_deposit,liquidity_withdrawal,cancelation,token_transfer,asset_creation
```

**Option 2 — rewalk node blocks only for sparse types:**

```python
# for h in range(start, tip+1):
#   body = node.get_block(h)
#   for each limitSwap / match / …: upsert meta + parties by hash
```

**Option 3 — if raw bodies were stored:** re-parse offline without node.

### 7.4 Verify on the host

```bash
BASE="http://127.0.0.1:<read-api-port>"   # or public BASE
ADDR="56ed966df64571675f38be3b4219862dbbec8f0e69140de3"
HASH_LS="8bd387e5c94c0ce4ad12f23c3e676e8c9fe6902b97057e3ee152437bf51cfa6d"
HASH_M="b3f14bb8a9fd9a0548c434c0654ac911e0db526c35dd324654cd31323655f824"

# After backfill of height 122994:
curl -sS "$BASE/transactions/$HASH_LS" | jq .
# expect meta.side=buy, meta.asset_name=MHJ, meta.order_amount=12..., meta.summary starts with BUY

curl -sS "$BASE/transactions/$HASH_M" | jq .
# expect meta.base_amount, meta.quote_amount, meta.asset_name=MHJ, meta.summary contains "MHJ"

curl -sS "$BASE/accounts/$ADDR/transactions?group=limit_swap&count=1" | jq '.data.transactions[0]'
curl -sS "$BASE/accounts/$ADDR/transactions?group=match&count=1" | jq '.data.transactions[0]'
```

SQL checks:

```sql
-- adapt table/column names
SELECT type, COUNT(*),
       COUNT(*) FILTER (WHERE meta <> '{}'::jsonb) AS with_meta
FROM txs
WHERE type IN ('limit_swap','match','liquidity_deposit','liquidity_withdrawal')
GROUP BY type;

SELECT hash, type, amount, sender, meta
FROM txs
WHERE hash IN (
  '8bd387e5c94c0ce4ad12f23c3e676e8c9fe6902b97057e3ee152437bf51cfa6d',
  'b3f14bb8a9fd9a0548c434c0654ac911e0db526c35dd324654cd31323655f824'
);
```

---

## 8. Acceptance criteria

### Rich detail (this guide)

- [ ] New `limit_swap` rows include non-empty `meta` with at least: `side`, `order_amount`, `asset_name`, `limit_price`, `summary`.  
- [ ] New `match` rows include non-empty `meta` with at least: `asset_name`, `base_amount` and/or `quote_amount`, `swap_count`, `summary`.  
- [ ] Account history + single-tx + block transaction list all expose the same fields.  
- [ ] Existing clients that ignore unknown fields still work (backward compatible).  
- [ ] Height **122994** sample hashes (above) pass the curl checks after backfill.  
- [ ] Balance accounting **does not** treat match / limit_swap meta amounts as extra WART transfers.

### Attribution (from match brief)

- [ ] Traders who got fills see `group=match` rows for their address.  
- [ ] Empty `sender`/`recipient` do not match every wallet.  
- [ ] `meta.tx-types` still lists `match`; `group=matches` alias still works.

### Performance

- [ ] List endpoint payload size remains reasonable (summary + a few strings; avoid dumping full poolBefore/poolAfter unless needed).  
- [ ] Optional: omit heavy pool snapshots from list; keep them only on `GET /transactions/{hash}` if you want detail-on-demand.

---

## 9. Wallet client notes (for after deploy)

WartBunker today:

1. Prefers indexer history.  
2. For sparse types, hydrates from node `getBlock(height)`.  

After this indexer work ships:

- Client can map `meta.summary` → card description, `meta.asset_name` → asset badge, `meta.order_amount` / base+quote → amount line.  
- Node hydration becomes optional fallback for old rows without `meta`.  
- Client code: `src/utils/warthogIndexer.js` (`normalizeIndexerTransaction`), `src/utils/accountHistoryCache.js` (enrich path).

**Suggested stable contract for the wallet:**

```text
tx.meta.summary          → description (preferred)
tx.meta.asset_name       → asset symbol
tx.meta.order_amount     → amount for limit_swap (if amount is 0)
tx.meta.base_amount      → amount for match (base)
tx.meta.quote_amount     → secondary / WART leg
tx.meta.side             → buy|sell
tx.meta.limit_price      → limit
```

Notify wallet team when backfill of at least recent history is done so hydration can be demoted.

---

## 10. Copy this file onto the server

From your laptop / build machine (repo root):

```bash
scp docs/indexer-defi-tx-detail-guide.md root@217.216.94.146:/root/
# optional: also send the match attribution brief
scp docs/indexer-match-wallet-attribution-brief.md root@217.216.94.146:/root/
```

On the server:

```bash
ssh root@217.216.94.146
less /root/indexer-defi-tx-detail-guide.md
# place next to the read-api repo if useful:
# mv /root/indexer-defi-tx-detail-guide.md /opt/warthog-read-api/docs/
```

---

## 11. Priority order for implementers

1. **`meta` on limit_swap + match** (biggest wallet UX win; unblocks dropping node hydrate).  
2. **Backfill** recent heights (or full DeFi range).  
3. **Match party attribution** via `historyId` → limit_swap owner (completeness of Matches tab for makers).  
4. **liquidity / cancel / token** meta (same pattern).  
5. Tell wallet team when public API returns `meta` so client can prefer it.

---

## 12. Contact / product intent

**Product intent:** Wallet transaction history cards for DeFi should be as informative as when history came from the node, while listing/filtering stays on the indexer.

**Not a product requirement:** using match/limit_swap rows for balance math (balances stay on node balance endpoints).

Questions / sample hashes for regression: height `122994`, address `56ed966d…40de3`, limit_swap `8bd387e5…`, match `b3f14bb8…`.
