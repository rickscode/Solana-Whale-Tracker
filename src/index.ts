import {
    MIN_BUY_ALERT_USD,
    MIN_SELL_ALERT_USD,
    POLL_INTERVAL_MS,
    SEED_LOOKBACK_HOURS,
    validateEnvVariables
} from './config/constants';
import { DetectedSwap, SwapEvent, TradeRow, Wallet } from './types';
import { testConnection as testSupabase } from './database/supabase';
import { getActiveWallets, getLatestTradeTime, insertTrade } from './database/queries';
import * as helius from './services/helius';
import * as telegram from './services/telegram';
import { getNativePriceUsd, getTokenInfo } from './services/dexscreener';
import { parseSolanaSwap } from './services/parser';
import { getRobinhoodSwaps } from './services/robinhood';
import { logger } from './utils/logger';

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// A wallet's first pass records its back history without alerting on it.
const seeded = new Set<string>();

async function buildRow(swap: SwapEvent, wallet: Wallet, raw: unknown): Promise<TradeRow> {
    const info = await getTokenInfo(swap.chain, swap.tokenAddress);

    // A routed swap can pay partly in stablecoins and partly in SOL, so both
    // legs count. If a SOL leg can't be priced, the total is unknown rather
    // than the stablecoin half, which would understate the trade.
    const hasUsd = swap.quoteUsd !== 0;
    const hasNative = swap.quoteNative !== 0;

    let usdValue: number | null = null;
    let total = swap.quoteUsd;
    let priced = true;

    if (hasNative) {
        const nativePrice = await getNativePriceUsd(swap.chain);
        if (nativePrice === null) {
            priced = false;
        } else {
            total += swap.quoteNative * nativePrice;
        }
    }
    // A negative total means the routing legs outweighed the trade legs, so the
    // netting did not capture this swap. Leave the value unknown rather than
    // publish a sell that appears to have lost money on the proceeds.
    if (priced && (hasUsd || hasNative) && total > 0) {
        usdValue = total;
    }

    const quoteSymbol = hasUsd && hasNative ? 'MIXED' : hasNative ? swap.nativeSymbol : 'USD';
    const quoteAmount = hasNative && !hasUsd ? swap.quoteNative : swap.quoteUsd;

    // Their effective fill, derived from what actually moved - not the current
    // market price, which has already drifted by the time we see the trade.
    const priceUsd =
        usdValue !== null && swap.tokenAmount > 0 ? usdValue / swap.tokenAmount : info.priceUsd;

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
        price_usd: priceUsd,
        dex: swap.dex ?? info.dexId,
        liquidity_usd: info.liquidityUsd,
        market_cap_usd: info.marketCapUsd,
        pair_url: info.pairUrl,
        block_time: new Date(swap.blockTime * 1000).toISOString(),
        raw
    };
}

/** Route a wallet to its chain's adapter. Both emit the same SwapEvent shape. */
async function detectSwaps(wallet: Wallet, since: number): Promise<DetectedSwap[]> {
    if (wallet.chain === 'robinhood') {
        return getRobinhoodSwaps(wallet.address, since);
    }
    const txs = await helius.getRecentSwaps(wallet.address, since);
    const out: DetectedSwap[] = [];
    for (const tx of txs) {
        const swap = parseSolanaSwap(tx, wallet.address);
        if (swap) {
            out.push({ swap, raw: tx });
        }
    }
    return out;
}

async function processWallet(wallet: Wallet): Promise<void> {
    const isSeeding = !seeded.has(wallet.address);

    // Resume from the newest trade already recorded, with a minute of overlap
    // so a swap sharing a timestamp with it can't slip through. Duplicates are
    // free - the unique constraint absorbs them.
    const latest = await getLatestTradeTime(wallet.chain, wallet.address);
    const since = latest !== null
        ? latest - 60
        : Math.floor(Date.now() / 1000) - SEED_LOOKBACK_HOURS * 3600;

    const detected = await detectSwaps(wallet, since);

    // Oldest first, so the trade log reads chronologically.
    for (const { swap, raw } of [...detected].reverse()) {
        try {
            const row = await buildRow(swap, wallet, raw);

            // Already have it - the unique constraint decides, not local state.
            if (!(await insertTrade(row))) {
                continue;
            }

            const value = row.usd_value !== null ? formatValue(row.usd_value) : 'unknown value';
            logger.info(
                `${row.side.toUpperCase()} ${row.token_symbol ?? row.token_address} by ${wallet.label} (${value})`
            );

            if (isSeeding) {
                continue;
            }
            // A trade with no derivable value is an airdrop or a bridge-in, not
            // something to act on, so it is stored but never alerted.
            const threshold = row.side === 'buy' ? MIN_BUY_ALERT_USD : MIN_SELL_ALERT_USD;
            if (row.usd_value === null || row.usd_value < threshold) {
                continue;
            }
            await telegram.sendTradeAlert(row);
        } catch (error) {
            // One bad transaction must never stop the cycle or block later ones.
            logger.error(`Failed on ${swap.txHash}:`, error instanceof Error ? error.message : error);
        }
    }

    if (isSeeding) {
        seeded.add(wallet.address);
        logger.info(
            `Seeded ${wallet.label} from the last ${SEED_LOOKBACK_HOURS}h - alerts start from the next cycle`
        );
    }
}

function formatValue(usd: number): string {
    return `$${usd.toFixed(2)}`;
}

async function monitoringLoop(): Promise<void> {
    for (;;) {
        try {
            // Re-read every cycle, so adding a wallet needs no restart.
            const wallets = await getActiveWallets();
            if (wallets.length === 0) {
                logger.warn('No active wallets - add a row to the wallets table');
            }

            for (const wallet of wallets) {
                try {
                    await processWallet(wallet);
                } catch (error) {
                    logger.error(
                        `Wallet ${wallet.label} failed this cycle:`,
                        error instanceof Error ? error.message : error
                    );
                }
                await sleep(1000);
            }
        } catch (error) {
            logger.error('Cycle failed:', error instanceof Error ? error.message : error);
        }

        await sleep(POLL_INTERVAL_MS);
    }
}

async function main(): Promise<void> {
    logger.info('Starting whale tracker...');
    validateEnvVariables();

    if (!(await testSupabase())) {
        throw new Error('Supabase connection failed');
    }

    const wallets = await getActiveWallets();
    if (wallets.length === 0) {
        throw new Error('No active wallets - run schema.sql, or add a row to the wallets table');
    }
    logger.info(`Loaded ${wallets.length} wallet(s): ${wallets.map(w => w.label).join(', ')}`);

    const solanaWallet = wallets.find(w => w.chain === 'solana');
    if (solanaWallet && !(await helius.testConnection(solanaWallet.address))) {
        throw new Error('Helius connection failed');
    }
    if (!(await telegram.testConnection())) {
        throw new Error('Telegram connection failed');
    }

    logger.info(`Polling every ${POLL_INTERVAL_MS}ms`);
    await monitoringLoop();
}

process.on('SIGINT', () => {
    logger.info('Shutting down');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('Shutting down');
    process.exit(0);
});

main().catch(error => {
    logger.error('Fatal:', error instanceof Error ? error.message : error);
    process.exit(1);
});
