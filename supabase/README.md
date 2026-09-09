# Always-on deployment

Two functions replace the local poller:

- **`whale-webhook`** - Helius pushes Solana transactions here as they happen.
  Alerts land a second or two after the trade.
- **`whale-sweep`** - runs every 5 minutes. Polls Robinhood Chain, which has no
  webhook provider, and reconciles Solana in case a webhook push was dropped.

Both share `_shared/`, and `_shared/parser.ts` is generated from
`src/services/parser.ts` so the two runtimes cannot drift. Regenerate with
`npm run sync:functions`.

## Why this shape

Polling from an edge function does not fit the free tier: 14 wallets parsing a
page of transactions each is roughly 250ms of CPU, and at 5-minute polling that
is ~2,160 CPU-seconds a month against a 500 limit. Pushing instead means the
function only runs when a whale actually trades - a few hundred invocations a
month, well inside the allowance.

## Deploy

```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
```

Set the secrets the functions need (Supabase injects SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY on its own):

```bash
npx supabase secrets set \
  HELIUS_API_KEY=... \
  TELEGRAM_BOT_TOKEN=... \
  TELEGRAM_CHAT_ID=... \
  WEBHOOK_SECRET=... \
  MIN_BUY_ALERT_USD=300 \
  MIN_SELL_ALERT_USD=300
```

`WEBHOOK_SECRET` is any long random string; generate one with
`openssl rand -hex 32`. Helius sends it back as the `Authorization` header, which
is what stops the public URL being spoofed.

Deploy both with JWT verification off - Helius and pg_cron send our own secret
rather than a Supabase token:

```bash
npx supabase functions deploy whale-webhook --no-verify-jwt
npx supabase functions deploy whale-sweep --no-verify-jwt
```

## Schedule the sweep

Edit `supabase/schedule.sql`, replacing `<PROJECT_REF>` and `<WEBHOOK_SECRET>`,
then run it in the SQL Editor.

## Register the Helius webhook

The free plan allows one webhook. Point it at the deployed function with every
tracked Solana address:

```bash
curl -X POST "https://api.helius.xyz/v0/webhooks?api-key=$HELIUS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "webhookURL": "https://<PROJECT_REF>.supabase.co/functions/v1/whale-webhook",
    "transactionTypes": ["SWAP"],
    "accountAddresses": ["<solana addresses>"],
    "webhookType": "enhanced",
    "authHeader": "<WEBHOOK_SECRET>"
  }'
```

Adding a wallet later means updating the webhook's `accountAddresses` as well as
inserting the row - `npm run webhook:sync` does both from the database.

## Retiring the local poller

Once alerts arrive from the cloud, stop the local one:

```bash
pm2 delete whale-tracker
```

Both can run at once safely - deduplication is a database constraint, so
whichever sees a trade first alerts and the other stays quiet.
