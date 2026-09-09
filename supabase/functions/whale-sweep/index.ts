// Cron-driven sweep, doing two jobs.
//
// Robinhood Chain has no webhook provider, so it is polled here.
//
// Solana is reconciled rather than polled: webhook delivery is not guaranteed,
// and a dropped push would otherwise be a permanently missed trade. Anything
// the webhook already stored is a duplicate here and alerts nobody twice, so
// this costs nothing when everything is working.
import { getActiveWallets, getLatestTradeTime } from '../_shared/db.ts';
import { getRecentSwaps } from '../_shared/helius.ts';
import { parseSolanaSwaps } from '../_shared/parser.ts';
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

    const detected = wallet.chain === 'robinhood'
        ? await getRobinhoodSwaps(wallet.address, since - 60)
        : (await getRecentSwaps(wallet.address, since - 60))
            .flatMap(tx => parseSolanaSwaps(tx, wallet.address).map(swap => ({ swap, raw: tx })));

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

    const wallets = await getActiveWallets();
    for (const wallet of wallets) {
        try {
            await sweepWallet(wallet, tally);
        } catch (error) {
            tally.errors++;
            console.error(`${wallet.chain}/${wallet.label} failed:`, error instanceof Error ? error.message : error);
        }
    }

    console.log(JSON.stringify({ wallets: wallets.length, ...tally }));
    return Response.json({ wallets: wallets.length, ...tally });
});
