import { HeliusTransaction, Side, SwapEvent } from '../types';
import { QUOTE_MINTS, STABLE_MINTS, WRAPPED_SOL } from '../config/constants';

/**
 * Turn a Helius SWAP into a chain-agnostic SwapEvent, or null if it is not a
 * swap this wallet took part in.
 *
 * Solana addresses are base58 and case-sensitive, so these compare with ===.
 * Lowercasing them (an EVM habit) can collapse two distinct addresses into one.
 */
export function parseSolanaSwap(tx: HeliusTransaction, wallet: string): SwapEvent | null {
    if (tx.type !== 'SWAP' || tx.transactionError) {
        return null;
    }

    // Net every non-quote leg per mint. A routed swap can deliver the same
    // token in several tranches, and can bounce an intermediate token in and
    // out; taking the first leg reports a fraction of the fill, and counting
    // an intermediate hop invents a trade that never happened.
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

    // The trade is the token that actually moved most; anything that nets to
    // zero was only passing through.
    const moved = [...deltas.entries()].filter(([, amount]) => amount !== 0);
    moved.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const traded = moved[0];
    if (!traded) {
        return null;
    }

    const [tokenMint, tokenDelta] = traded;
    const side: Side = tokenDelta > 0 ? 'buy' : 'sell';

    const quote = netQuoteLegs(tx, wallet, side);

    return {
        chain: 'solana',
        txHash: tx.signature,
        blockTime: tx.timestamp,
        side,
        tokenAddress: tokenMint,
        tokenAmount: Math.abs(tokenDelta),
        quoteNative: quote.sol,
        nativeSymbol: 'SOL',
        quoteUsd: quote.usd,
        dex: tx.source || null
    };
}

/**
 * What the wallet actually paid (buy) or received (sell).
 *
 * A routed swap splits the payment across several legs and often bounces
 * through the wallet's own wrapped-SOL account, so every leg has to be summed
 * and the opposite direction subtracted. Taking a single leg reports a
 * fraction of the trade; ignoring the return legs reports a multiple of it.
 *
 * Legs that never touch the wallet belong to the router, not the trader, and
 * are excluded entirely.
 */
function netQuoteLegs(
    tx: HeliusTransaction,
    wallet: string,
    side: Side
): { sol: number; usd: number } {
    // On a buy the quote leaves the wallet; on a sell it arrives.
    const sign = (from: string, to: string): number => {
        const out = from === wallet;
        const inbound = to === wallet;
        if (out === inbound) {
            return 0; // untouched by this wallet, or a self-transfer
        }
        const spending = side === 'buy';
        return out === spending ? 1 : -1;
    };

    let usd = 0;
    let sol = 0;
    let sawWrappedSol = false;

    for (const t of tx.tokenTransfers ?? []) {
        const direction = sign(t.fromUserAccount, t.toUserAccount);
        if (direction === 0) {
            continue;
        }
        if (STABLE_MINTS.has(t.mint)) {
            usd += direction * t.tokenAmount;
        } else if (t.mint === WRAPPED_SOL) {
            sawWrappedSol = true;
            sol += direction * t.tokenAmount;
        }
    }

    // Native lamports only count when nothing was wrapped, otherwise a
    // wrap-then-swap gets charged twice for the same SOL.
    if (!sawWrappedSol) {
        for (const n of tx.nativeTransfers ?? []) {
            sol += sign(n.fromUserAccount, n.toUserAccount) * (n.amount / 1e9);
        }
    }

    return { sol, usd };
}
