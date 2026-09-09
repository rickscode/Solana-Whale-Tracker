import { HeliusTransaction, Side, SwapEvent } from '../types';
import { DUST_TOKEN_AMOUNT, QUOTE_MINTS, STABLE_MINTS, WRAPPED_SOL } from '../config/constants';

/**
 * Every trade this wallet made in one transaction.
 *
 * A transaction can hold more than one: a token-for-token swap gives up one
 * asset and takes another, and both sides matter. It can also hold none - a
 * mass airdrop reaches hundreds of wallets in a single transaction, and being
 * one of the recipients is not a trade.
 *
 * Solana addresses are base58 and case-sensitive, so these compare with ===.
 * Lowercasing them (an EVM habit) can collapse two distinct addresses into one.
 */
export function parseSolanaSwaps(tx: HeliusTransaction, wallet: string): SwapEvent[] {
    if (tx.type !== 'SWAP' || tx.transactionError) {
        return [];
    }

    // Net each non-quote token. A routed swap can deliver one token in several
    // tranches, and can bounce an intermediate token in and straight back out.
    const deltas = new Map<string, number>();
    for (const transfer of tx.tokenTransfers ?? []) {
        if (QUOTE_MINTS.has(transfer.mint)) {
            continue;
        }
        const inbound = transfer.toUserAccount === wallet;
        const outbound = transfer.fromUserAccount === wallet;
        if (inbound === outbound) {
            continue;
        }
        const signed = inbound ? transfer.tokenAmount : -transfer.tokenAmount;
        deltas.set(transfer.mint, (deltas.get(transfer.mint) ?? 0) + signed);
    }

    const moved = [...deltas.entries()].filter(([, amount]) => Math.abs(amount) >= DUST_TOKEN_AMOUNT);
    if (moved.length === 0) {
        return [];
    }

    const flow = netQuoteFlow(tx, wallet);
    const paidSomething = flow.usd !== 0 || flow.native !== 0;
    const gaveUpToken = moved.some(([, amount]) => amount < 0);

    // Tokens arrived, nothing left the wallet: an airdrop or a transfer in.
    if (!paidSomething && !gaveUpToken) {
        return [];
    }

    // With a single traded token the quote flow is unambiguously its price.
    // With several - a token-for-token swap - there is no honest way to split
    // one quote figure between them, so they are valued at market instead.
    const attributable = moved.length === 1 && paidSomething;

    return moved.map(([tokenMint, tokenDelta]) => {
        const side: Side = tokenDelta > 0 ? 'buy' : 'sell';
        const sign = side === 'buy' ? -1 : 1; // buying spends the quote, selling receives it
        return {
            chain: 'solana' as const,
            txHash: tx.signature,
            blockTime: tx.timestamp,
            side,
            tokenAddress: tokenMint,
            tokenAmount: Math.abs(tokenDelta),
            quoteNative: attributable ? sign * flow.native : 0,
            quoteUsd: attributable ? sign * flow.usd : 0,
            nativeSymbol: 'SOL',
            dex: tx.source || null
        };
    });
}

/**
 * Net quote movement for the wallet, positive when received.
 *
 * Only legs touching the wallet count: a routed swap moves quote assets between
 * pools, and those belong to the router rather than the trader. Legs are summed
 * rather than taken one at a time, because a payment is often split across
 * several, and netted, because a swap frequently bounces through the wallet's
 * own wrapped-SOL account and back.
 */
function netQuoteFlow(tx: HeliusTransaction, wallet: string): { usd: number; native: number } {
    let usd = 0;
    let native = 0;
    let sawWrappedSol = false;

    for (const transfer of tx.tokenTransfers ?? []) {
        const inbound = transfer.toUserAccount === wallet;
        const outbound = transfer.fromUserAccount === wallet;
        if (inbound === outbound) {
            continue;
        }
        const signed = inbound ? transfer.tokenAmount : -transfer.tokenAmount;
        if (STABLE_MINTS.has(transfer.mint)) {
            usd += signed;
        } else if (transfer.mint === WRAPPED_SOL) {
            sawWrappedSol = true;
            native += signed;
        }
    }

    // Native lamports only count when nothing was wrapped, otherwise a
    // wrap-then-swap is charged twice for the same SOL.
    if (!sawWrappedSol) {
        for (const transfer of tx.nativeTransfers ?? []) {
            const inbound = transfer.toUserAccount === wallet;
            const outbound = transfer.fromUserAccount === wallet;
            if (inbound === outbound) {
                continue;
            }
            native += (inbound ? transfer.amount : -transfer.amount) / 1e9;
        }
    }

    return { usd, native };
}
