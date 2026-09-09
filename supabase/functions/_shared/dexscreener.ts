import { ROBINHOOD_WETH, WRAPPED_SOL } from './config.ts';
import type { TokenInfo } from './types.ts';

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
    symbol: null, name: null, priceUsd: null,
    liquidityUsd: null, marketCapUsd: null, dexId: null, pairUrl: null
};

// Survives only while the isolate is warm, which is exactly when it helps.
const cache = new Map<string, { value: TokenInfo; at: number }>();

/** Solana addresses are base58 and case-sensitive; EVM hex addresses are not. */
function sameAddress(chain: string, a: string | undefined, b: string): boolean {
    if (!a) return false;
    return chain === 'solana' ? a === b : a.toLowerCase() === b.toLowerCase();
}

export async function getTokenInfo(chain: string, address: string): Promise<TokenInfo> {
    const key = `${chain}:${address}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

    let info = UNKNOWN;
    try {
        const res = await fetch(`${BASE_URL}/${address}`, {
            signal: AbortSignal.timeout(15_000),
            headers: { 'User-Agent': 'whale-tracker/1.0' }
        });
        if (!res.ok) return UNKNOWN;

        const body = await res.json() as { pairs?: DexPair[] };
        const pairs = (body.pairs ?? []).filter(
            p => p.chainId === chain && sameAddress(chain, p.baseToken?.address, address)
        );
        // Up to 30 pairs come back per token; only the deepest has an honest price.
        pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

        const best = pairs[0];
        if (best) {
            const price = Number.parseFloat(best.priceUsd ?? '');
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
    } catch {
        return UNKNOWN; // not cached, so the next call retries
    }

    cache.set(key, { value: info, at: Date.now() });
    return info;
}

export async function getNativePriceUsd(chain: string): Promise<number | null> {
    const wrapped = chain === 'robinhood' ? ROBINHOOD_WETH : WRAPPED_SOL;
    return (await getTokenInfo(chain, wrapped)).priceUsd;
}
