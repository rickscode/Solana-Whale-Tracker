// Cron-driven sweep for Robinhood Chain.
//
// Robinhood Chain has no webhook provider, so it is polled here, through a free
// public RPC that costs nothing per call.
//
// Solana is deliberately not swept. It used to be reconciled here against
// dropped webhook pushes, but that went through Helius's Enhanced Transactions
// API at 100 credits a call - eight wallets hourly is ~576,000 credits a month
// against a free allowance of 100,000, and at 5-minute intervals it exhausted
// the account outright. Solana now relies on the webhook alone, at 1 credit per
// push. A dropped push means a missed trade rather than a late one.
import { getActiveWallets, getLatestTradeTime } from '../_shared/db.ts';
import { getRobinhoodSwaps } from '../_shared/robinhood.ts';
import { recordAndAlert } from '../_shared/trade.ts';
import type { Wallet } from '../_shared/types.ts';

/** History pulled in on a wallet's first ever pass. */
const SEED_LOOKBACK_HOURS = 24;

async function sweepWallet(wallet: Wallet, tally: Record<string, number>): Promise<void> {
    const latest = await getLatestTradeTime(wallet.chain, wallet.address);

    // Only a wallet with nothing stored is backfilled silently; once there is a
    // resume point, everything after it is genuinely new and must be alerted.
    const silent = latest === null;
    const since = latest ?? Math.floor(Date.now() / 1000) - SEED_LOOKBACK_HOURS * 3600;

    const detected = await getRobinhoodSwaps(wallet.address, since - 60);

    for (const { swap, raw } of [...detected].reverse()) {
        try {
            tally[await recordAndAlert(swap, wallet, raw, silent)]++;
        } catch (error) {
            tally.errors++;
            console.error(`${wallet.label} ${swap.txHash}:`, error instanceof Error ? error.message : error);
        }
    }
}

Deno.serve(async () => {
    const tally: Record<string, number> = {
        alerted: 0, 'below-threshold': 0, unpriced: 0, duplicate: 0, silent: 0, errors: 0
    };

    const wallets = await getActiveWallets('robinhood');
    for (const wallet of wallets) {
        try {
            await sweepWallet(wallet, tally);
        } catch (error) {
            tally.errors++;
            console.error(`${wallet.label} failed:`, error instanceof Error ? error.message : error);
        }
    }

    console.log(JSON.stringify({ wallets: wallets.length, ...tally }));
    return Response.json({ wallets: wallets.length, ...tally });
});
