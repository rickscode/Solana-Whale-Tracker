import { SERVICE_ROLE_KEY, SUPABASE_URL } from './config.ts';
import type { TradeRow, Wallet } from './types.ts';

const rest = (path: string): string => `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`;
const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra
});

export async function getActiveWallets(chain?: string): Promise<Wallet[]> {
    const filter = chain ? `&chain=eq.${chain}` : '';
    const res = await fetch(rest(`wallets?select=chain,address,label&is_active=is.true${filter}&order=added_at`), {
        headers: headers()
    });
    if (!res.ok) {
        throw new Error(`Failed to load wallets: ${res.status} ${await res.text()}`);
    }
    return await res.json() as Wallet[];
}

/** Unix seconds of the newest trade recorded for a wallet, or null if none. */
export async function getLatestTradeTime(chain: string, address: string): Promise<number | null> {
    const res = await fetch(
        rest(`whale_trades?select=block_time&chain=eq.${chain}&wallet_address=eq.${address}&order=block_time.desc&limit=1`),
        { headers: headers() }
    );
    if (!res.ok) {
        throw new Error(`Failed to read latest trade time: ${res.status}`);
    }
    const rows = await res.json() as Array<{ block_time: string }>;
    return rows.length > 0 ? Math.floor(new Date(rows[0].block_time).getTime() / 1000) : null;
}

/**
 * Insert a trade, ignoring one we already have.
 *
 * Returns true only when the row was genuinely new. The unique constraint does
 * the deduplication, which is what lets the webhook and the sweep both process
 * the same trade without it being alerted twice.
 */
export async function insertTrade(row: TradeRow, attempt = 0): Promise<boolean> {
    const res = await fetch(rest('whale_trades?on_conflict=chain,tx_hash,wallet_address,token_address'), {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=ignore-duplicates,return=representation' }),
        body: JSON.stringify(row)
    });

    if (!res.ok) {
        // A dropped insert is gone for good, so transient failures are retried.
        if ((res.status >= 500 || res.status === 408) && attempt < 3) {
            await new Promise(r => setTimeout(r, 400 * 2 ** attempt));
            return insertTrade(row, attempt + 1);
        }
        throw new Error(`Failed to insert trade ${row.tx_hash}: ${res.status} ${await res.text()}`);
    }
    const inserted = await res.json() as unknown[];
    return inserted.length > 0;
}
