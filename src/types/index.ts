export type Chain = 'solana' | 'robinhood';
export type Side = 'buy' | 'sell';

export interface Wallet {
    chain: Chain;
    address: string;
    label: string;
}

// --- Helius (Solana) ---

export interface HeliusTokenTransfer {
    fromUserAccount: string;
    toUserAccount: string;
    mint: string;
    tokenAmount: number;
}

export interface HeliusNativeTransfer {
    fromUserAccount: string;
    toUserAccount: string;
    amount: number; // lamports
}

export interface HeliusTransaction {
    type: string;
    source: string; // RAYDIUM | JUPITER | PUMP_FUN | ...
    signature: string;
    timestamp: number; // unix seconds
    tokenTransfers: HeliusTokenTransfer[];
    nativeTransfers: HeliusNativeTransfer[];
    transactionError: unknown | null;
}

// --- Chain-agnostic ---

/**
 * What every chain adapter emits. Adding a chain means producing this shape;
 * nothing downstream of the parser needs to know which chain it came from.
 */
export interface SwapEvent {
    chain: Chain;
    txHash: string;
    blockTime: number; // unix seconds
    side: Side;
    tokenAddress: string;
    tokenAmount: number;
    /** Net SOL paid (buy) or received (sell), after cancelling routing hops. */
    quoteSol: number;
    /** Net stablecoin paid or received, already in USD. */
    quoteUsd: number;
    dex: string | null;
}

export interface TokenInfo {
    symbol: string | null;
    name: string | null;
    priceUsd: number | null;
    liquidityUsd: number | null;
    marketCapUsd: number | null;
    dexId: string | null;
    pairUrl: string | null;
}

/** A row in whale_trades. Column names match the SQL exactly. */
export interface TradeRow {
    chain: Chain;
    wallet_address: string;
    wallet_label: string;
    side: Side;
    tx_hash: string;
    token_address: string;
    token_symbol: string | null;
    token_name: string | null;
    token_amount: number;
    quote_symbol: string;
    quote_amount: number;
    usd_value: number | null;
    price_usd: number | null;
    dex: string | null;
    liquidity_usd: number | null;
    market_cap_usd: number | null;
    pair_url: string | null;
    block_time: string; // ISO
    raw: unknown;
}
