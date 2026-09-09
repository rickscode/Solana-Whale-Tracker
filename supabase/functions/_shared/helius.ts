import { HELIUS_API_KEY, HELIUS_API_URL } from './config.ts';
import type { HeliusTransaction } from './types.ts';

/**
 * Swaps after `sinceUnix`, newest first.
 *
 * Pages backwards rather than reading one fixed window: a wallet that transfers
 * or burns heavily can put hundreds of transactions between two swaps, and a
 * single page would show none of them.
 */
export async function getRecentSwaps(
    address: string,
    sinceUnix: number,
    maxPages = 3
): Promise<HeliusTransaction[]> {
    const swaps: HeliusTransaction[] = [];
    let before: string | undefined;

    for (let page = 0; page < maxPages; page++) {
        const url = new URL(`${HELIUS_API_URL}/addresses/${address}/transactions`);
        url.searchParams.set('api-key', HELIUS_API_KEY);
        url.searchParams.set('limit', '100');
        if (before) url.searchParams.set('before', before);

        const res = await fetch(url, {
            signal: AbortSignal.timeout(30_000),
            headers: { 'User-Agent': 'whale-tracker/1.0' }
        });
        if (!res.ok) throw new Error(`Helius ${res.status} for ${address}`);

        const txs = await res.json() as HeliusTransaction[];
        if (txs.length === 0) break;

        for (const tx of txs) {
            if (tx.type === 'SWAP' && !tx.transactionError && tx.timestamp > sinceUnix) {
                swaps.push(tx);
            }
        }

        const oldest = txs[txs.length - 1];
        if (oldest.timestamp <= sinceUnix) break;
        before = oldest.signature;
    }

    return swaps;
}
