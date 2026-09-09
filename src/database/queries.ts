import { getSupabase } from './supabase';
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
export async function insertTrade(row: TradeRow): Promise<boolean> {
    const { data, error } = await getSupabase()
        .from('whale_trades')
        .upsert(row, {
            onConflict: 'chain,tx_hash,wallet_address,token_address',
            ignoreDuplicates: true
        })
        .select('id');

    if (error) {
        throw new Error(`Failed to insert trade ${row.tx_hash}: ${error.message}`);
    }
    return (data?.length ?? 0) > 0;
}
