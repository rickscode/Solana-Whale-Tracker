import { getSupabase } from './supabase';
import { INSERT_BACKOFF_MS, INSERT_MAX_RETRIES } from '../config/constants';
import { TradeRow, Wallet } from '../types';

export async function getActiveWallets(): Promise<Wallet[]> {
    const { data, error } = await getSupabase()
        .from('wallets')
        .select('chain, address, label')
        .eq('is_active', true)
        .order('added_at', { ascending: true });

    if (error) {
        throw new Error(`Failed to load wallets: ${error.message}`);
    }
    return (data ?? []) as Wallet[];
}

/**
 * Insert a trade, ignoring one we already have.
 *
 * Returns true only when the row was genuinely new. The unique constraint on
 * (chain, tx_hash, wallet_address, token_address) does the deduplication, so
 * re-reading the same transactions every poll is harmless and there is no
 * separate bookkeeping to drift out of sync.
 */
export async function insertTrade(row: TradeRow, attempt = 0): Promise<boolean> {
    const { data, error } = await getSupabase()
        .from('whale_trades')
        .upsert(row, {
            onConflict: 'chain,tx_hash,wallet_address,token_address',
            ignoreDuplicates: true
        })
        .select('id');

    if (error) {
        // A trade dropped here is gone for good: the next cycle resumes from the
        // newest stored trade, so an older one that failed is never revisited.
        // Transient gateway errors are therefore worth retrying rather than losing.
        const transient = /timeout|gateway|fetch failed|network|ECONN|502|503|504/i.test(
            `${error.message} ${error.code ?? ''}`
        );
        if (transient && attempt < INSERT_MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, INSERT_BACKOFF_MS * 2 ** attempt));
            return insertTrade(row, attempt + 1);
        }
        throw new Error(`Failed to insert trade ${row.tx_hash}: ${error.message}`);
    }
    return (data?.length ?? 0) > 0;
}

/** Unix seconds of the newest trade recorded for a wallet, or null if none. */
export async function getLatestTradeTime(chain: string, walletAddress: string): Promise<number | null> {
    const { data, error } = await getSupabase()
        .from('whale_trades')
        .select('block_time')
        .eq('chain', chain)
        .eq('wallet_address', walletAddress)
        .order('block_time', { ascending: false })
        .limit(1);

    if (error) {
        throw new Error(`Failed to read latest trade time: ${error.message}`);
    }
    const newest = data?.[0]?.block_time;
    return newest ? Math.floor(new Date(newest).getTime() / 1000) : null;
}
