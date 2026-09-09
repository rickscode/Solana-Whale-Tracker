import * as dotenv from 'dotenv';

dotenv.config();

// Monitoring
export const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '10000', 10);
/** Alert thresholds, per side. Everything is still recorded either way. */
export const MIN_BUY_ALERT_USD = parseFloat(process.env.MIN_BUY_ALERT_USD || '300');
export const MIN_SELL_ALERT_USD = parseFloat(process.env.MIN_SELL_ALERT_USD || '300');
export const PAGE_SIZE = 100;
/** How far back a single cycle will page before giving up. */
export const MAX_PAGES = parseInt(process.env.MAX_PAGES || '5', 10);
/** History pulled in on a wallet's first cycle. */
export const SEED_LOOKBACK_HOURS = parseInt(process.env.SEED_LOOKBACK_HOURS || '24', 10);

// Solana mints
export const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

/** Mints that fund a trade rather than being the thing traded. */
export const STABLE_MINTS = new Set([USDC_MINT, USDT_MINT]);
export const QUOTE_MINTS = new Set([WRAPPED_SOL, USDC_MINT, USDT_MINT]);

// Helius
export const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
export const HELIUS_API_URL = 'https://api.helius.xyz/v0';

// Supabase
export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Telegram
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

export function validateEnvVariables(): void {
    const required = [
        'HELIUS_API_KEY',
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'TELEGRAM_BOT_TOKEN',
        'TELEGRAM_CHAT_ID'
    ];

    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
}

// --- Robinhood Chain (EVM, chain id 4663, Arbitrum Orbit) ---
export const ROBINHOOD_RPC_URL = process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
/** keccak256("Transfer(address,address,uint256)") */
export const ERC20_TRANSFER_TOPIC =
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const ROBINHOOD_WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
export const ROBINHOOD_USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
/** Assets that fund a trade here rather than being the thing traded. */
export const ROBINHOOD_QUOTES = new Set([ROBINHOOD_WETH, ROBINHOOD_USDG]);
export const ROBINHOOD_STABLES = new Set([ROBINHOOD_USDG]);
/** ~0.101s blocks, so a generous margin still costs little. */
export const ROBINHOOD_BLOCK_SECONDS = 0.101;
export const ROBINHOOD_MAX_BLOCK_SPAN = parseInt(process.env.ROBINHOOD_MAX_BLOCK_SPAN || '250000', 10);
/** The public Robinhood RPC is shared, so retry its rate limits rather than losing trades. */
export const RPC_MAX_RETRIES = parseInt(process.env.RPC_MAX_RETRIES || '4', 10);
export const RPC_BACKOFF_MS = parseInt(process.env.RPC_BACKOFF_MS || '600', 10);
export const RPC_PACE_MS = parseInt(process.env.RPC_PACE_MS || '150', 10);
/** Below this, a leg is a rounding residue rather than a trade. */
export const DUST_TOKEN_AMOUNT = 1e-9;
