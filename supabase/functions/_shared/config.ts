// Supabase injects these two into every function.
export const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
export const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export const HELIUS_API_KEY = Deno.env.get('HELIUS_API_KEY') ?? '';
export const HELIUS_API_URL = 'https://api.helius.xyz/v0';
export const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
export const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID') ?? '';

/** Shared secret Helius sends back, so the public URL cannot be spoofed. */
export const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') ?? '';

export const MIN_BUY_ALERT_USD = Number(Deno.env.get('MIN_BUY_ALERT_USD') ?? '300');
export const MIN_SELL_ALERT_USD = Number(Deno.env.get('MIN_SELL_ALERT_USD') ?? '300');

// Solana
export const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
export const STABLE_MINTS = new Set([USDC_MINT, USDT_MINT]);
export const QUOTE_MINTS = new Set([WRAPPED_SOL, USDC_MINT, USDT_MINT]);

// Robinhood Chain (EVM, chain id 4663)
export const ROBINHOOD_RPC_URL = Deno.env.get('ROBINHOOD_RPC_URL') ?? 'https://rpc.mainnet.chain.robinhood.com';
export const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const ROBINHOOD_WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
export const ROBINHOOD_USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
export const ROBINHOOD_QUOTES = new Set([ROBINHOOD_WETH, ROBINHOOD_USDG]);
export const ROBINHOOD_STABLES = new Set([ROBINHOOD_USDG]);
export const ROBINHOOD_BLOCK_SECONDS = 0.101;
export const ROBINHOOD_MAX_BLOCK_SPAN = Number(Deno.env.get('ROBINHOOD_MAX_BLOCK_SPAN') ?? '250000');

/** Below this, a leg is a rounding residue rather than a trade. */
export const DUST_TOKEN_AMOUNT = 1e-9;
