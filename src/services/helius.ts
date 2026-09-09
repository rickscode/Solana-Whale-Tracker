import axios from 'axios';
import { HELIUS_API_KEY, HELIUS_API_URL, MAX_PAGES, PAGE_SIZE } from '../config/constants';
import { HeliusTransaction } from '../types';
import { logger } from '../utils/logger';

const client = axios.create({
    baseURL: HELIUS_API_URL,
    timeout: 30_000,
    headers: { 'Content-Type': 'application/json' }
});

async function fetchPage(address: string, before?: string): Promise<HeliusTransaction[]> {
    try {
        const response = await client.get(`/addresses/${address}/transactions`, {
            params: { 'api-key': HELIUS_API_KEY, limit: PAGE_SIZE, ...(before ? { before } : {}) }
        });
        return (response.data ?? []) as HeliusTransaction[];
    } catch (error) {
        if (axios.isAxiosError(error)) {
            if (error.response?.status === 429) {
                logger.warn('Helius rate limit hit - raise POLL_INTERVAL_MS or track fewer wallets');
            }
            logger.error(
                `Helius error for ${address}:`,
                error.response?.status,
                error.response?.data?.error ?? error.message
            );
        } else {
            logger.error(`Unexpected Helius error for ${address}:`, error);
        }
        throw error;
    }
}

/**
 * Every swap this wallet made after `sinceUnix`, newest first.
 *
 * Pages backwards rather than reading one fixed window, because a wallet that
 * transfers or burns heavily can push hundreds of transactions between two
 * swaps - a single page of 100 would show none of them. Stops as soon as a
 * page reaches older than `sinceUnix`, so the steady state is one request.
 *
 * The server-side `type=SWAP` filter is deliberately not used: it returns an
 * incomplete set, omitting swaps that a full scan finds.
 */
export async function getRecentSwaps(address: string, sinceUnix: number): Promise<HeliusTransaction[]> {
    const swaps: HeliusTransaction[] = [];
    let before: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
        const txs = await fetchPage(address, before);
        if (txs.length === 0) {
            break;
        }

        for (const tx of txs) {
            if (tx.type === 'SWAP' && !tx.transactionError && tx.timestamp > sinceUnix) {
                swaps.push(tx);
            }
        }

        const oldest = txs[txs.length - 1];
        if (oldest.timestamp <= sinceUnix) {
            break; // caught up with what we already have
        }
        before = oldest.signature;

        if (page === MAX_PAGES - 1) {
            logger.warn(`${address} still had older activity after ${MAX_PAGES} pages - raise MAX_PAGES if this repeats`);
        }
    }

    return swaps;
}

export async function testConnection(probeAddress: string): Promise<boolean> {
    try {
        await fetchPage(probeAddress);
        logger.info('Helius connected');
        return true;
    } catch {
        return false;
    }
}
