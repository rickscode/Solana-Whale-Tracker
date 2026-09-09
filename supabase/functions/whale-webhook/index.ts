// Receives Helius enhanced-transaction pushes and alerts in near real time.
//
// Always answers 200 unless the caller is unauthorised: Helius retries failures
// and auto-disables a webhook with a high failure rate, so a transient error on
// our side must not take the whole subscription down.
import { WEBHOOK_SECRET } from '../_shared/config.ts';
import { getActiveWallets } from '../_shared/db.ts';
import { parseSolanaSwaps } from '../_shared/parser.ts';
import { recordAndAlert } from '../_shared/trade.ts';
import type { HeliusTransaction, Wallet } from '../_shared/types.ts';

let walletCache: { value: Wallet[]; at: number } | null = null;

async function solanaWallets(): Promise<Wallet[]> {
    if (walletCache && Date.now() - walletCache.at < 60_000) return walletCache.value;
    const value = await getActiveWallets('solana');
    walletCache = { value, at: Date.now() };
    return value;
}

Deno.serve(async (req: Request) => {
    if (WEBHOOK_SECRET && req.headers.get('authorization') !== WEBHOOK_SECRET) {
        return new Response('unauthorized', { status: 401 });
    }

    const summary = { received: 0, alerted: 0, stored: 0, skipped: 0, errors: 0 };

    try {
        const body = await req.json();
        const txs: HeliusTransaction[] = Array.isArray(body) ? body : [body];
        summary.received = txs.length;

        const wallets = await solanaWallets();

        for (const tx of txs) {
            // One transaction can touch more than one tracked wallet.
            for (const wallet of wallets) {
                for (const swap of parseSolanaSwaps(tx, wallet.address)) {
                    try {
                        const outcome = await recordAndAlert(swap, wallet, tx);
                        if (outcome === 'alerted') summary.alerted++;
                        else if (outcome === 'duplicate') summary.skipped++;
                        else summary.stored++;
                    } catch (error) {
                        summary.errors++;
                        console.error(`failed on ${swap.txHash}:`, error instanceof Error ? error.message : error);
                    }
                }
            }
        }
    } catch (error) {
        summary.errors++;
        console.error('webhook body error:', error instanceof Error ? error.message : error);
    }

    console.log(JSON.stringify(summary));
    return Response.json(summary);
});
