import axios from 'axios';
import { ROBINHOOD_WETH, WRAPPED_SOL } from '../config/constants';
import { TokenInfo } from '../types';
import { logger } from '../utils/logger';

const BASE_URL = 'https://api.dexscreener.com/latest/dex/tokens';
const CACHE_TTL_MS = 60_000;

interface DexPair {
    chainId?: string;
    dexId?: string;
    url?: string;
    baseToken?: { address?: string; name?: string; symbol?: string };
    priceUsd?: string;
    liquidity?: { usd?: number };
    marketCap?: number;
    fdv?: number;
}

const UNKNOWN: TokenInfo = {
    symbol: null,
    name: null,
    priceUsd: null,
    liquidityUsd: null,
    marketCapUsd: null,
    dexId: null,
    pairUrl: null
};

const cache = new Map<string, { value: TokenInfo; at: number }>();

/** Solana addresses are base58 and case-sensitive; EVM hex addresses are not. */
function sameAddress(chain: string, a: string | undefined, b: string): boolean {
    if (!a) {
        return false;
    }
    return chain === 'solana' ? a === b : a.toLowerCase() === b.toLowerCase();
}

export async function getTokenInfo(chain: string, address: string): Promise<TokenInfo> {
    const key = `${chain}:${address}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return cached.value;
    }

    let info = UNKNOWN;

    try {
        const response = await axios.get(`${BASE_URL}/${address}`, { timeout: 15_000 });

        const pairs: DexPair[] = (response.data?.pairs ?? []).filter(
            (pair: DexPair) => pair.chainId === chain && sameAddress(chain, pair.baseToken?.address, address)
        );

        // Up to 30 pairs come back per token; only the deepest one has an honest price.
        pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

        const best = pairs[0];
        if (best) {
            const price = parseFloat(best.priceUsd ?? '');
            info = {
                symbol: best.baseToken?.symbol ?? null,
                name: best.baseToken?.name ?? null,
                priceUsd: Number.isFinite(price) ? price : null,
                liquidityUsd: best.liquidity?.usd ?? null,
                marketCapUsd: best.marketCap ?? best.fdv ?? null,
                dexId: best.dexId ?? null,
                pairUrl: best.url ?? null
            };
        }
    } catch (error) {
        // A brand new token often has no pair yet; that is normal, not fatal.
        logger.warn(`DexScreener lookup failed for ${address}:`, error instanceof Error ? error.message : error);
        return UNKNOWN; // not cached, so the next poll retries
    }

    cache.set(key, { value: info, at: Date.now() });
    return info;
}

/** USD price of a chain's native asset, used to value trades paid in it. */
export async function getNativePriceUsd(chain: string): Promise<number | null> {
    const wrapped = chain === 'robinhood' ? ROBINHOOD_WETH : WRAPPED_SOL;
    const info = await getTokenInfo(chain, wrapped);
    return info.priceUsd;
}
