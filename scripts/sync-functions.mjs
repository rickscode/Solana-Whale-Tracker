// Keeps the edge function's copy of the parser byte-identical to the Node one.
// The logic is pure; only the import lines differ between the two runtimes.
import { readFileSync, writeFileSync } from 'node:fs';

const HEADER = [
    '// Generated from src/services/parser.ts - do not edit here.',
    '// Regenerate with: npm run sync:functions',
    '// The logic is pure, so the Node poller and the edge function share it exactly.',
    '', ''
].join('\n');

const REWRITES = [
    ["import { HeliusTransaction, Side, SwapEvent } from '../types';",
     "import type { HeliusTransaction, Side, SwapEvent } from './types.ts';"],
    ["import { DUST_TOKEN_AMOUNT, QUOTE_MINTS, STABLE_MINTS, WRAPPED_SOL } from '../config/constants';",
     "import { DUST_TOKEN_AMOUNT, QUOTE_MINTS, STABLE_MINTS, WRAPPED_SOL } from './config.ts';"]
];

let out = HEADER + readFileSync('src/services/parser.ts', 'utf-8');
for (const [from, to] of REWRITES) {
    if (!out.includes(from)) {
        console.error(`sync failed: expected import not found:\n  ${from}`);
        process.exit(1);
    }
    out = out.replace(from, to);
}
writeFileSync('supabase/functions/_shared/parser.ts', out);
console.log('synced supabase/functions/_shared/parser.ts');
