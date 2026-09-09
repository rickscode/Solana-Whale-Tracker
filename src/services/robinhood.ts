import axios from 'axios';
import {
    ERC20_TRANSFER_TOPIC,
    ROBINHOOD_BLOCK_SECONDS,
    ROBINHOOD_MAX_BLOCK_SPAN,
    ROBINHOOD_QUOTES,
    ROBINHOOD_RPC_URL,
    ROBINHOOD_STABLES,
    DUST_TOKEN_AMOUNT,
    ROBINHOOD_WETH,
    RPC_BACKOFF_MS,
    RPC_MAX_RETRIES,
    RPC_PACE_MS
} from '../config/constants';
import { DetectedSwap, SwapEvent } from '../types';
import { logger } from '../utils/logger';

interface RpcLog {
    address: string;
    topics: string[];
    data: string;
    blockNumber: string;
    transactionHash: string;
}

const decimalsCache = new Map<string, number>();
const blockTimeCache = new Map<number, number>();

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The public RPC is shared and rate limits under load, which is normal rather
 * than exceptional here: one seeding pass makes a receipt call per swap. Back
 * off and retry instead of dropping the trade.
 */
async function rpc<T>(method: string, params: unknown[], attempt = 0): Promise<T> {
    try {
        const { data } = await axios.post(
            ROBINHOOD_RPC_URL,
            { jsonrpc: '2.0', id: 1, method, params },
            { timeout: 45_000, headers: { 'Content-Type': 'application/json' } }
        );
        if (data.error) {
            throw new Error(`${method}: ${JSON.stringify(data.error)}`);
        }
        return data.result as T;
    } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const retryable = status === 429 || (status !== undefined && status >= 500);
        if (retryable && attempt < RPC_MAX_RETRIES) {
            await sleep(RPC_BACKOFF_MS * 2 ** attempt);
            return rpc<T>(method, params, attempt + 1);
        }
        throw error;
    }
}

const topicAddress = (address: string): string => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
const fromTopic = (topic: string): string => `0x${topic.slice(-40)}`.toLowerCase();

async function getDecimals(token: string): Promise<number> {
    const key = token.toLowerCase();
    const cached = decimalsCache.get(key);
    if (cached !== undefined) {
        return cached;
    }
    let decimals = 18; // ERC-20 default, and correct for almost everything here
    try {
        const raw = await rpc<string>('eth_call', [{ to: token, data: '0x313ce567' }, 'latest']);
        if (raw && raw !== '0x') {
            decimals = parseInt(raw, 16);
        }
    } catch {
        // a token that doesn't implement decimals() keeps the default
    }
    decimalsCache.set(key, decimals);
    return decimals;
}

async function getBlockTime(blockNumber: number): Promise<number> {
    const cached = blockTimeCache.get(blockNumber);
    if (cached !== undefined) {
        return cached;
    }
    const block = await rpc<{ timestamp: string }>('eth_getBlockByNumber', [
        `0x${blockNumber.toString(16)}`,
        false
    ]);
    const ts = parseInt(block.timestamp, 16);
    blockTimeCache.set(blockNumber, ts);
    return ts;
}

/**
 * Every swap this account made after `sinceUnix`, newest first.
 *
 * There is no decoded-transaction API for this chain, so swaps are derived from
 * ERC-20 Transfer logs where the account is sender or recipient. That is also
 * the only workable angle: pump.fun submits these through a relayer, so the
 * transaction sender is never the trader - only the token flow identifies them.
 *
 * Routed swaps hop through several contracts within one transaction, so per-token
 * amounts are netted per transaction and legs that cancel are discarded.
 */
export async function getRobinhoodSwaps(address: string, sinceUnix: number): Promise<DetectedSwap[]> {
    const latest = parseInt(await rpc<string>('eth_blockNumber', []), 16);
    const secondsBack = Math.max(0, Math.floor(Date.now() / 1000) - sinceUnix);
    // 20% margin because block time drifts; duplicates are absorbed downstream.
    const span = Math.min(ROBINHOOD_MAX_BLOCK_SPAN, Math.ceil((secondsBack / ROBINHOOD_BLOCK_SECONDS) * 1.2) + 100);
    const fromBlock = Math.max(0, latest - span);

    const padded = topicAddress(address);
    const [sent, received] = await Promise.all([
        rpc<RpcLog[]>('eth_getLogs', [
            { topics: [ERC20_TRANSFER_TOPIC, padded, null], fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${latest.toString(16)}` }
        ]),
        rpc<RpcLog[]>('eth_getLogs', [
            { topics: [ERC20_TRANSFER_TOPIC, null, padded], fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${latest.toString(16)}` }
        ])
    ]);

    // Net each token per transaction, so routing hops through the account cancel.
    const byTx = new Map<string, { block: number; deltas: Map<string, bigint>; logs: RpcLog[] }>();
    const me = address.toLowerCase();

    for (const log of [...sent, ...received]) {
        if (log.topics.length < 3) {
            continue;
        }
        const entry = byTx.get(log.transactionHash) ?? {
            block: parseInt(log.blockNumber, 16),
            deltas: new Map<string, bigint>(),
            logs: []
        };
        const token = log.address.toLowerCase();
        const value = BigInt(log.data === '0x' ? '0x0' : log.data);
        const inbound = fromTopic(log.topics[2]) === me;
        const outbound = fromTopic(log.topics[1]) === me;
        if (inbound === outbound) {
            continue; // self-transfer, or not actually ours
        }
        entry.deltas.set(token, (entry.deltas.get(token) ?? 0n) + (inbound ? value : -value));
        entry.logs.push(log);
        byTx.set(log.transactionHash, entry);
    }

    const swaps: DetectedSwap[] = [];

    for (const [txHash, entry] of byTx) {
        const moved = [...entry.deltas.entries()].filter(([, v]) => v !== 0n);
        const candidates: Array<{ token: string; delta: bigint; amount: number }> = [];
        let quoteMoved = false;

        for (const [token, delta] of moved) {
            if (ROBINHOOD_QUOTES.has(token)) {
                quoteMoved = true;
                continue;
            }
            // Raw integers of tokens with different decimals are not comparable,
            // so scale before doing anything with them.
            const amount = Math.abs(Number(delta) / 10 ** (await getDecimals(token)));
            if (amount >= DUST_TOKEN_AMOUNT) {
                candidates.push({ token, delta, amount });
            }
        }

        if (candidates.length === 0) {
            continue; // pure quote movement - a transfer or bridge, not a trade
        }

        const blockTime = await getBlockTime(entry.block);
        if (blockTime <= sinceUnix) {
            continue;
        }

        // Only a single traded token can claim the transaction's quote leg; a
        // token-for-token swap has no honest way to split one figure in two.
        const paid = candidates.length === 1
            ? await priceFromPoolLeg(txHash, candidates[0].token)
            : { native: 0, usd: 0 };

        // The relayer pays, so a genuine buy also shows nothing leaving the
        // wallet - "did they pay" cannot separate a trade from an airdrop here.
        // Having a price can: a trade has one, a mass distribution does not.
        // Those arrive with hundreds of recipients in a single transaction, and
        // counting them as buys invents trades that never happened.
        const gaveUpToken = candidates.some(c => c.delta < 0n);
        const hasPrice = paid.native > 0 || paid.usd > 0;
        if (!hasPrice && !gaveUpToken && !quoteMoved) {
            continue;
        }

        for (const { token, delta, amount } of candidates) {
            const side: SwapEvent['side'] = delta > 0n ? 'buy' : 'sell';

            swaps.push({
                swap: {
                    chain: 'robinhood',
                    txHash,
                    blockTime,
                    side,
                    tokenAddress: token,
                    tokenAmount: amount,
                    quoteNative: candidates.length === 1 ? paid.native : 0,
                    quoteUsd: candidates.length === 1 ? paid.usd : 0,
                    nativeSymbol: 'ETH',
                    dex: 'uniswap'
                },
                raw: { txHash, block: entry.block, logs: entry.logs.length }
            });
        }
        await sleep(RPC_PACE_MS);
    }

    swaps.sort((a, b) => b.swap.blockTime - a.swap.blockTime);
    return swaps;
}

/**
 * What the trade actually cost, taken from the transaction rather than the account.
 *
 * pump.fun routes these through a relayer that pays on the trader's behalf, so
 * the quote leg never touches the trader's address - from their account alone a
 * buy is indistinguishable from an airdrop.
 *
 * The quote passes through several router hops carrying the same amount at each
 * one, so the largest leg is the trade and the repeats are that same money in
 * flight. Summing them would multiply the price by the number of hops. Legs are
 * restricted to addresses that handled the traded token, so an unrelated
 * transfer riding along in the same transaction cannot inflate it.
 *
 * Identifying the pool exactly was tried and is less robust: route shapes vary
 * enough that the pool is sometimes unidentifiable, or pays in a token the
 * trader never sees. This heuristic matches every trade checked against
 * pump.fun's own figures.
 */
async function priceFromPoolLeg(
    txHash: string,
    tradedToken: string
): Promise<{ native: number; usd: number }> {
    let receipt: { logs: RpcLog[] };
    try {
        receipt = await rpc<{ logs: RpcLog[] }>('eth_getTransactionReceipt', [txHash]);
    } catch (error) {
        logger.warn(`Could not read receipt for ${txHash}:`, error instanceof Error ? error.message : error);
        return { native: 0, usd: 0 };
    }

    const transfers = (receipt?.logs ?? []).filter(
        l => l.topics?.[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC && l.topics.length >= 3
    );

    const handlers = new Set<string>();
    for (const log of transfers) {
        if (log.address.toLowerCase() !== tradedToken) {
            continue;
        }
        handlers.add(fromTopic(log.topics[1]));
        handlers.add(fromTopic(log.topics[2]));
    }

    let native = 0;
    let usd = 0;
    for (const log of transfers) {
        const token = log.address.toLowerCase();
        if (!ROBINHOOD_QUOTES.has(token)) {
            continue;
        }
        if (!handlers.has(fromTopic(log.topics[1])) && !handlers.has(fromTopic(log.topics[2]))) {
            continue;
        }
        const decimals = await getDecimals(token);
        const amount = Number(BigInt(log.data === '0x' ? '0x0' : log.data)) / 10 ** decimals;
        if (ROBINHOOD_STABLES.has(token)) {
            usd = Math.max(usd, amount);
        } else if (token === ROBINHOOD_WETH) {
            native = Math.max(native, amount);
        }
    }

    return { native, usd };
}

export async function testConnection(): Promise<boolean> {
    try {
        const chainId = parseInt(await rpc<string>('eth_chainId', []), 16);
        logger.info(`Robinhood Chain connected (chain id ${chainId})`);
        return chainId === 4663;
    } catch (error) {
        logger.error('Robinhood Chain connection failed:', error instanceof Error ? error.message : error);
        return false;
    }
}
