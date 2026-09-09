export type Chain = 'solana' | 'robinhood';
export type Side = 'buy' | 'sell';

export interface Wallet {
    chain: Chain;
    address: string;
    label: string;
}

export interface HeliusTokenTransfer {
    fromUserAccount: string;
    toUserAccount: string;
    mint: string;
    tokenAmount: number;
}

export interface HeliusNativeTransfer {
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
}

export interface HeliusTransaction {
    type: string;
    source: string;
    signature: string;
    timestamp: number;
    tokenTransfers: HeliusTokenTransfer[];
    nativeTransfers: HeliusNativeTransfer[];
    transactionError: unknown | null;
}

export interface SwapEvent {
    chain: Chain;
    txHash: string;
    blockTime: number;
    side: Side;
    tokenAddress: string;
    tokenAmount: number;
    quoteNative: number;
    quoteUsd: number;
    nativeSymbol: string;
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
    block_time: string;
    raw: unknown;
}
