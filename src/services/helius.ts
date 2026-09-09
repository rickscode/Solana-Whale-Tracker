import axios from 'axios';
import { HELIUS_API_KEY, HELIUS_API_URL, TX_FETCH_LIMIT } from '../config/constants';
import { HeliusTransaction } from '../types';
import { logger } from '../utils/logger';

const client = axios.create({
    baseURL: HELIUS_API_URL,
    timeout: 30_000,
    headers: { 'Content-Type': 'application/json' }
});

export async function getWalletTransactions(
    address: string,
    limit: number = TX_FETCH_LIMIT
): Promise<HeliusTransaction[]> {
    try {
        const response = await client.get(`/addresses/${address}/transactions`, {
            params: { 'api-key': HELIUS_API_KEY, limit }
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

export async function testConnection(probeAddress: string): Promise<boolean> {
    try {
        await getWalletTransactions(probeAddress, 1);
        logger.info('Helius connected');
        return true;
    } catch {
        return false;
    }
}
