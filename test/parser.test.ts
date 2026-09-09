// Regression tests for the swap parser.
// The synthetic cases cover the shapes that have caused real bugs; the
// fixtures are genuine transactions pulled from the chain.
// Run with: npm test

import { parseSolanaSwaps } from '../src/services/parser';
import { HeliusTransaction, SwapEvent } from '../src/types';
import * as fs from 'fs';

const W = '4UrFSCrGxgoCtCUBAEZq7ZmPK3Pczkxx7PwYnkBMi1KR';
const A = '5MztePcdvyzJr4Dd1Wj15scXEeddst1sMp759aNWf7gm';
const WSOL = 'So11111111111111111111111111111111111111112';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const PEPE = 'PePeXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const base = { signature: 's', timestamp: 1, transactionError: null, nativeTransfers: [] };
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) < tol;
const tt = (from: string, to: string, mint: string, amt: number) =>
    ({ fromUserAccount: from, toUserAccount: to, mint, tokenAmount: amt });
const swap = (extra: Record<string, unknown>) =>
    ({ ...base, type: 'SWAP', source: 'JUPITER', tokenTransfers: [], ...extra }) as HeliusTransaction;

let failed = 0;
function check(name: string, ok: boolean, got: unknown, want: string): void {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}\n       want ${want}\n       got  ${JSON.stringify(got)}`);
    }
}
const one = (r: SwapEvent[]): SwapEvent | undefined => (r.length === 1 ? r[0] : undefined);

let r = parseSolanaSwaps(swap({ source: 'PUMP_FUN', tokenTransfers: [tt('pool', W, BONK, 1e6), tt(W, 'pool', WSOL, 2.5)] }), W);
check('buy paid in wrapped SOL', !!one(r) && r[0].side === 'buy' && near(r[0].quoteNative, 2.5) && r[0].quoteUsd === 0, r, 'sol 2.5');

r = parseSolanaSwaps(swap({ tokenTransfers: [tt(W, 'pool', BONK, 500), tt('pool', W, USDC, 123.45)] }), W);
check('sell received USDC', !!one(r) && r[0].side === 'sell' && near(r[0].quoteUsd, 123.45), r, 'usd 123.45');

r = parseSolanaSwaps(swap({ tokenTransfers: [tt(W, 'pA', WSOL, 4), tt('pA', 'pB', WSOL, 999), tt('pB', W, BONK, 42)] }), W);
check('router legs excluded', !!one(r) && near(r[0].quoteNative, 4), r, 'sol 4 not 999');

r = parseSolanaSwaps(swap({ source: 'PUMP_FUN', nativeTransfers: [{ fromUserAccount: W, toUserAccount: 'p', amount: 1.5e9 }], tokenTransfers: [tt('p', W, BONK, 7)] }), W);
check('native SOL fallback', !!one(r) && near(r[0].quoteNative, 1.5), r, 'sol 1.5');

r = parseSolanaSwaps(swap({ tokenTransfers: [tt('p', W, BONK, 10), tt(W, 'p', USDC, 100), tt(W, 'p', USDC, 250), tt(W, 'p', WSOL, 5), tt('p', W, WSOL, 5)] }), W);
check('split quote legs summed, wrap cancels', !!one(r) && near(r[0].quoteUsd, 350) && near(r[0].quoteNative, 0), r, 'usd 350 sol 0');

r = parseSolanaSwaps(swap({ tokenTransfers: [tt('p', W, BONK, 600000), tt('p', W, BONK, 2100000), tt(W, 'p', USDC, 7000)] }), W);
check('multi-tranche token summed', !!one(r) && near(r[0].tokenAmount, 2700000, 0.01), r, '2,700,000 tokens');

r = parseSolanaSwaps(swap({ tokenTransfers: [tt('p', W, PEPE, 999999), tt(W, 'p', PEPE, 999999), tt('p', W, BONK, 42), tt(W, 'p', USDC, 10)] }), W);
check('pass-through token ignored', !!one(r) && r[0].tokenAddress === BONK && near(r[0].tokenAmount, 42), r, 'BONK 42');

r = parseSolanaSwaps(swap({ tokenTransfers: [tt('p', W, BONK, 1e-12), tt(W, 'p', USDC, 5)] }), W);
check('dust residue rejected', r.length === 0, r, 'no trades');

// airdrop: tokens arrive, nothing is given up
r = parseSolanaSwaps(swap({ tokenTransfers: [tt('distributor', W, BONK, 5000)] }), W);
check('airdrop is not a trade', r.length === 0, r, 'no trades');

// token-for-token: both sides are real trades
r = parseSolanaSwaps(swap({ tokenTransfers: [tt(W, 'p', PEPE, 100), tt('p', W, BONK, 250)] }), W);
const sell = r.find(e => e.side === 'sell');
const buy = r.find(e => e.side === 'buy');
check('token-for-token emits both sides',
    r.length === 2 && !!sell && sell.tokenAddress === PEPE && near(sell.tokenAmount, 100)
    && !!buy && buy.tokenAddress === BONK && near(buy.tokenAmount, 250)
    && sell.quoteUsd === 0 && buy.quoteUsd === 0,
    r, 'sell 100 PEPE + buy 250 BONK, both unpriced');

for (const [n, tx] of [
    ['failed tx', swap({ transactionError: { e: 1 } })],
    ['non-swap', { ...base, type: 'TRANSFER', source: 'x', tokenTransfers: [] } as HeliusTransaction],
    ['not our wallet', swap({ tokenTransfers: [tt('a', 'b', BONK, 1)] })]
] as [string, HeliusTransaction][]) {
    check(`${n} rejected`, parseSolanaSwaps(tx, W).length === 0, null, 'no trades');
}

// real transactions pulled from the chain
const axe = JSON.parse(fs.readFileSync(`${__dirname}/fixtures/axe-nasduck.json`, 'utf-8'));
const want = [2908064.8719, 2773400.7066];
axe.slice(0, 2).forEach((raw: HeliusTransaction, i: number) => {
    const s = parseSolanaSwaps(raw, A);
    check(`REAL AXE Nasduck #${i + 1}`,
        !!one(s) && near(s[0].tokenAmount, want[i], 0.01) && s[0].quoteUsd > 6900,
        s, `${want[i]} tokens, ~$7000`);
});

const cc = JSON.parse(fs.readFileSync(`${__dirname}/fixtures/crimecat-buy.json`, 'utf-8'));
const s2 = parseSolanaSwaps(cc as HeliusTransaction, W);
check('REAL CRIMECAT buy',
    !!one(s2) && near(Math.round(s2[0].quoteUsd * 100) / 100, 3333.57, 0.01) && Math.abs(s2[0].quoteNative) < 1e-6,
    s2, 'usd 3333.57');

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
