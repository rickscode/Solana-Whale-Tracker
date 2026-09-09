import {
    DUST_TOKEN_AMOUNT,
    ERC20_TRANSFER_TOPIC,
    ROBINHOOD_BLOCK_SECONDS,
    ROBINHOOD_MAX_BLOCK_SPAN,
    ROBINHOOD_QUOTES,
    ROBINHOOD_RPC_URL,
    ROBINHOOD_STABLES,
    ROBINHOOD_WETH
} from './config.ts';
import type { SwapEvent } from './types.ts';

interface RpcLog {
    address: string;
    topics: string[];
    data: string;
    blockNumber: string;
    transactionHash: string;
}

export interface DetectedSwap {
    swap: SwapEvent;
    raw: unknown;
}

const decimalsCache = new Map<string, number>();
const blockTimeCache = new Map<number, number>();
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/** The public RPC is shared and rate limits under load; back off rather than lose a trade. */
async function rpc<T>(method: string, params: unknown[], attempt = 0): Promise<T> {
    const res = await fetch(ROBINHOOD_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'whale-tracker/1.0' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(30_000)
    });

    if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < 4) {
            await sleep(600 * 2 ** attempt);
            return rpc<T>(method, params, attempt + 1);
        }
        throw new Error(`${method}: HTTP ${res.status}`);
    }
    const body = await res.json() as { result?: T; error?: unknown };
    if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    return body.result as T;
}

const topicAddress = (a: string): string => `0x${a.slice(2).toLowerCase().padStart(64, '0')}`;
const fromTopic = (t: string): string => `0x${t.slice(-40)}`.toLowerCase();

async function getDecimals(token: string): Promise<number> {
    const key = token.toLowerCase();
    const cached = decimalsCache.get(key);
    if (cached !== undefined) return cached;

    let decimals = 18;
    try {
        const raw = await rpc<string>('eth_call', [{ to: token, data: '0x313ce567' }, 'latest']);
        if (raw && raw !== '0x') decimals = Number.parseInt(raw, 16);
    } catch {
        // a token that does not implement decimals() keeps the default
    }
    decimalsCache.set(key, decimals);
    return decimals;
}

async function getBlockTime(blockNumber: number): Promise<number> {
    const cached = blockTimeCache.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await rpc<{ timestamp: string }>('eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, false]);
    const ts = Number.parseInt(block.timestamp, 16);
    blockTimeCache.set(blockNumber, ts);
    return ts;
}

/**
 * What the trade cost, taken from the transaction rather than the account.
 *
 * pump.fun routes these through a relayer that pays on the trader's behalf, so
 * the quote leg never touches the trader's address. The quote passes through
 * several router hops carrying the same amount each time, so the largest leg is
 * the trade and the repeats are that money in flight - summing would multiply
 * the price by the number of hops.
 */
async function priceFromPoolLeg(txHash: string, tradedToken: string): Promise<{ native: number; usd: number }> {
    let receipt: { logs: RpcLog[] };
    try {
        receipt = await rpc<{ logs: RpcLog[] }>('eth_getTransactionReceipt', [txHash]);
    } catch {
        return { native: 0, usd: 0 };
    }

    const transfers = (receipt?.logs ?? []).filter(
        l => l.topics?.[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC && l.topics.length >= 3
    );

    const handlers = new Set<string>();
    for (const log of transfers) {
        if (log.address.toLowerCase() !== tradedToken) continue;
        handlers.add(fromTopic(log.topics[1]));
        handlers.add(fromTopic(log.topics[2]));
    }

    let native = 0;
    let usd = 0;
    for (const log of transfers) {
        const token = log.address.toLowerCase();
        if (!ROBINHOOD_QUOTES.has(token)) continue;
        if (!handlers.has(fromTopic(log.topics[1])) && !handlers.has(fromTopic(log.topics[2]))) continue;

        const amount = Number(BigInt(log.data === '0x' ? '0x0' : log.data)) / 10 ** (await getDecimals(token));
        if (ROBINHOOD_STABLES.has(token)) usd = Math.max(usd, amount);
        else if (token === ROBINHOOD_WETH) native = Math.max(native, amount);
    }

    return { native, usd };
}

/** Every swap this account made after `sinceUnix`, newest first. */
export async function getRobinhoodSwaps(address: string, sinceUnix: number): Promise<DetectedSwap[]> {
    const latest = Number.parseInt(await rpc<string>('eth_blockNumber', []), 16);
    const secondsBack = Math.max(0, Math.floor(Date.now() / 1000) - sinceUnix);
    const span = Math.min(ROBINHOOD_MAX_BLOCK_SPAN, Math.ceil((secondsBack / ROBINHOOD_BLOCK_SECONDS) * 1.2) + 100);
    const fromBlock = Math.max(0, latest - span);

    const padded = topicAddress(address);
    const range = { fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${latest.toString(16)}` };
    const [sent, received] = await Promise.all([
        rpc<RpcLog[]>('eth_getLogs', [{ topics: [ERC20_TRANSFER_TOPIC, padded, null], ...range }]),
        rpc<RpcLog[]>('eth_getLogs', [{ topics: [ERC20_TRANSFER_TOPIC, null, padded], ...range }])
    ]);

    // Net each token per transaction so routing hops through the account cancel.
    const byTx = new Map<string, { block: number; deltas: Map<string, bigint>; logs: number }>();
    const me = address.toLowerCase();

    for (const log of [...sent, ...received]) {
        if (log.topics.length < 3) continue;
        const entry = byTx.get(log.transactionHash)
            ?? { block: Number.parseInt(log.blockNumber, 16), deltas: new Map<string, bigint>(), logs: 0 };
        const token = log.address.toLowerCase();
        const value = BigInt(log.data === '0x' ? '0x0' : log.data);
        const inbound = fromTopic(log.topics[2]) === me;
        const outbound = fromTopic(log.topics[1]) === me;
        if (inbound === outbound) continue;
        entry.deltas.set(token, (entry.deltas.get(token) ?? 0n) + (inbound ? value : -value));
        entry.logs += 1;
        byTx.set(log.transactionHash, entry);
    }

    const swaps: DetectedSwap[] = [];

    for (const [txHash, entry] of byTx) {
        const moved = [...entry.deltas.entries()].filter(([, v]) => v !== 0n);
        const candidates: Array<{ token: string; delta: bigint; amount: number }> = [];
        let quoteMoved = false;

        for (const [token, delta] of moved) {
            if (ROBINHOOD_QUOTES.has(token)) { quoteMoved = true; continue; }
            const amount = Math.abs(Number(delta) / 10 ** (await getDecimals(token)));
            if (amount >= DUST_TOKEN_AMOUNT) candidates.push({ token, delta, amount });
        }
        if (candidates.length === 0) continue;

        const blockTime = await getBlockTime(entry.block);
        if (blockTime <= sinceUnix) continue;

        // Only a single traded token can claim the transaction's quote leg.
        const paid = candidates.length === 1
            ? await priceFromPoolLeg(txHash, candidates[0].token)
            : { native: 0, usd: 0 };

        // The relayer pays, so a genuine buy also shows nothing leaving the
        // wallet - "did they pay" cannot separate a trade from an airdrop here.
        // Having a price can: a trade has one, a mass distribution does not.
        const gaveUpToken = candidates.some(c => c.delta < 0n);
        if (paid.native === 0 && paid.usd === 0 && !gaveUpToken && !quoteMoved) continue;

        for (const { token, delta, amount } of candidates) {
            swaps.push({
                swap: {
                    chain: 'robinhood',
                    txHash,
                    blockTime,
                    side: delta > 0n ? 'buy' : 'sell',
                    tokenAddress: token,
                    tokenAmount: amount,
                    quoteNative: candidates.length === 1 ? paid.native : 0,
                    quoteUsd: candidates.length === 1 ? paid.usd : 0,
                    nativeSymbol: 'ETH',
                    dex: 'uniswap'
                },
                raw: { txHash, block: entry.block, logs: entry.logs }
            });
        }
    }

    swaps.sort((a, b) => b.swap.blockTime - a.swap.blockTime);
    return swaps;
}
