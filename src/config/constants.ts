import * as dotenv from 'dotenv';

dotenv.config();

// Monitoring
export const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '10000', 10);
export const MIN_ALERT_USD = parseFloat(process.env.MIN_ALERT_USD || '0');
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
