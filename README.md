# Whale Tracker

Watches wallets on Solana and posts every swap they make to Telegram, with the
token name, mint, amount, DEX, liquidity and market cap - so you can decide
whether to copy the trade.

It does not trade. There are no private keys anywhere in this repo. The buy
decision is yours.

## How it works

```
Helius  ->  parser  ->  DexScreener  ->  Supabase  ->  Telegram
(swaps)     (side,      (name, price,   (trade log)   (alert)
             amount)     liquidity)
```

1. Polls the Helius Enhanced Transactions API for each active wallet
2. Keeps `SWAP` transactions and works out buy vs sell, the token, and what the
   wallet actually paid or received
3. Looks the token up on DexScreener for name, symbol, price, liquidity, market cap
4. Writes a row to `whale_trades`
5. Alerts on Telegram if the row was new

Deduplication is a database constraint, not application state: re-reading the
same transactions every poll is harmless, so there is no cursor to get out of
sync.

## Setup

### 1. Install

```bash
npm install
```

### 2. Database

Create a Supabase project, open the SQL Editor, and run `src/database/schema.sql`.
It creates `wallets` and `whale_trades`, and inserts the first wallet.

### 3. Credentials

```bash
cp .env.example .env
```

Fill in:

| Variable | Where to get it |
| --- | --- |
| `HELIUS_API_KEY` | [helius.dev](https://helius.dev) - free tier is 100k requests/day |
| `SUPABASE_URL` | Supabase > Project Settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | same page. **Not** the anon key - the tables have RLS on with no policies |
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/botfather) |
| `TELEGRAM_CHAT_ID` | message your bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `chat.id` |

### 4. Run

```bash
npm run dev     # watch mode
```

```bash
npm test        # parser regression suite
```

```bash
npm run build && npm start    # production
```

On a wallet's first cycle the tracker records its back history **without**
alerting, so you don't get a wall of messages on startup. Alerts begin from the
next cycle.

## Adding wallets

Insert a row - no code change, no restart. The wallet list is re-read every cycle.

```sql
insert into wallets (chain, address, label)
values ('solana', 'WALLET_ADDRESS_HERE', 'Whale 2');
```

Set `is_active = false` to pause one without losing its history.

## Using the trade log

Every detected swap lands in `whale_trades` with `status = 'new'`. Mark them as
you go:

```sql
-- what have I not looked at yet?
select block_time, wallet_label, side, token_symbol, usd_value, dex, liquidity_usd
from whale_trades
where status = 'new'
order by block_time desc;

-- record a decision
update whale_trades set status = 'copied' where id = 123;
```

Because it is a flat log rather than matched positions, P&L is a query when you
want it, not a thing the bot has to keep correct:

```sql
select token_symbol,
       sum(case when side = 'sell' then usd_value else -usd_value end) as net_usd
from whale_trades
where wallet_label = 'J777'
group by token_symbol
order by net_usd desc;
```

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `POLL_INTERVAL_MS` | `10000` | How often to check. Lower = faster alerts, more API calls |
| `MIN_ALERT_USD` | `0` | Suppress alerts below this value. Trades are still recorded, and trades of unknown value always alert |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug` |

## Notes and limits

- **USD values come from the counter-leg**, meaning what the wallet actually paid
  or received, not the current market price. SOL is priced live from DexScreener,
  cached for 60 seconds.
- **Native SOL amounts may include a small amount of fees and rent** (well under
  1% on a meaningful trade), since those share the transaction's native transfers.
- **Some Robinhood trades have no derivable price.** pump.fun routes them through
  a relayer that pays on the trader's behalf, so when there is no pool leg in the
  transaction there is nothing to price against. These are recorded with a null
  value and never alerted - they are mostly airdrops and bridge-ins rather than
  trades.
- **A brand new token may have no DexScreener pair yet.** The trade is still
  recorded; name, price and liquidity come through as null and the lookup retries
  on the next poll.
- **Transactions are paged, not windowed.** Each cycle pages back until it
  reaches trades already recorded, so a wallet that transfers or burns heavily
  can't bury its swaps behind hundreds of unrelated transactions. `MAX_PAGES`
  (default 5, i.e. 500 transactions) caps how far one cycle will go; it logs a
  warning if it hits the cap. A wallet's first cycle pulls
  `SEED_LOOKBACK_HOURS` of history (default 24).
- **`whale_trades` grows without bound.** Not an issue for a long time; prune old
  rows if it ever is.

## Scaling to other chains

The schema is chain-tagged and the parser emits a chain-agnostic `SwapEvent`, so
a second chain is one new adapter file - nothing downstream changes.

Robinhood Chain (`chainId: robinhood` on DexScreener) is the intended next one:
EVM, chain ID 4663, Arbitrum Orbit, running Uniswap, public RPC at
`https://rpc.mainnet.chain.robinhood.com`. Detection there is `eth_getLogs` on
ERC-20 `Transfer` events grouped by transaction, and DexScreener enrichment
already works for it.

## Project structure

```
src/
  config/constants.ts      env and chain constants
  database/
    schema.sql             the two tables
    supabase.ts            client
    queries.ts             getActiveWallets, insertTrade
  services/
    helius.ts              Solana transaction fetch
    parser.ts              transaction -> SwapEvent
    dexscreener.ts         token metadata and prices (cached)
    telegram.ts            alert formatting and delivery
  types/index.ts           shared types
  utils/                   logger, formatting
  index.ts                 polling loop
```
