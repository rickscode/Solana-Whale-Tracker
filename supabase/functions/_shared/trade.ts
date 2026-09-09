import { MIN_BUY_ALERT_USD, MIN_SELL_ALERT_USD } from './config.ts';
import { getNativePriceUsd, getTokenInfo } from './dexscreener.ts';
import { insertTrade } from './db.ts';
import { sendTradeAlert } from './telegram.ts';
import type { SwapEvent, TradeRow, Wallet } from './types.ts';

export async function buildRow(swap: SwapEvent, wallet: Wallet, raw: unknown): Promise<TradeRow> {
    const info = await getTokenInfo(swap.chain, swap.tokenAddress);

    const hasUsd = swap.quoteUsd !== 0;
    const hasNative = swap.quoteNative !== 0;

    let usdValue: number | null = null;
    let total = swap.quoteUsd;
    let priced = true;

    if (hasNative) {
        const nativePrice = await getNativePriceUsd(swap.chain);
        if (nativePrice === null) priced = false;
        else total += swap.quoteNative * nativePrice;
    }

    // A negative total means the routing legs outweighed the trade legs, so the
    // netting did not capture this swap. Leave it unknown rather than publish a
    // sell that appears to have lost money on the proceeds.
    if (priced && (hasUsd || hasNative) && total > 0) {
        usdValue = total;
    } else if (!hasUsd && !hasNative && info.priceUsd !== null) {
        // A token-for-token swap has no quote leg, so value it at market.
        usdValue = info.priceUsd * swap.tokenAmount;
    }

    const quoteSymbol = hasUsd && hasNative ? 'MIXED' : hasNative ? swap.nativeSymbol : 'USD';
    const quoteAmount = hasNative && !hasUsd ? swap.quoteNative : swap.quoteUsd;

    return {
        chain: swap.chain,
        wallet_address: wallet.address,
        wallet_label: wallet.label,
        side: swap.side,
        tx_hash: swap.txHash,
        token_address: swap.tokenAddress,
        token_symbol: info.symbol,
        token_name: info.name,
        token_amount: swap.tokenAmount,
        quote_symbol: quoteSymbol,
        quote_amount: quoteAmount,
        usd_value: usdValue,
        // Their effective fill, derived from what actually moved.
        price_usd: usdValue !== null && swap.tokenAmount > 0 ? usdValue / swap.tokenAmount : info.priceUsd,
        dex: swap.dex ?? info.dexId,
        liquidity_usd: info.liquidityUsd,
        market_cap_usd: info.marketCapUsd,
        pair_url: info.pairUrl,
        block_time: new Date(swap.blockTime * 1000).toISOString(),
        raw
    };
}

export type Outcome = 'alerted' | 'below-threshold' | 'unpriced' | 'duplicate' | 'silent';

/**
 * Store a trade and alert on it if it warrants one.
 *
 * `silent` suppresses the alert for a wallet's first-ever backfill, which would
 * otherwise arrive as a wall of messages. Deduplication happens in the database,
 * so the webhook and the sweep can both see the same trade and only one alerts.
 */
export async function recordAndAlert(
    swap: SwapEvent,
    wallet: Wallet,
    raw: unknown,
    silent = false
): Promise<Outcome> {
    const row = await buildRow(swap, wallet, raw);
    if (!(await insertTrade(row))) return 'duplicate';
    if (silent) return 'silent';

    // No derivable value means an airdrop or a bridge-in, not something to act on.
    if (row.usd_value === null) return 'unpriced';
    const threshold = row.side === 'buy' ? MIN_BUY_ALERT_USD : MIN_SELL_ALERT_USD;
    if (row.usd_value < threshold) return 'below-threshold';

    await sendTradeAlert(row);
    return 'alerted';
}
