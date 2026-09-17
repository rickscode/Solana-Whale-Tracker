import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from './config.ts';
import type { TradeRow } from './types.ts';

function formatUsd(amount: number | null): string {
    if (amount === null || !Number.isFinite(amount)) return 'n/a';
    const abs = Math.abs(amount);
    if (abs >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`;
    return `$${amount.toFixed(2)}`;
}

function formatPrice(price: number | null): string {
    if (price === null || !Number.isFinite(price)) return 'n/a';
    return price >= 1 ? `$${price.toFixed(4)}` : `$${price.toPrecision(4)}`;
}

const formatAmount = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 4 });
const truncate = (a: string): string => `${a.slice(0, 4)}...${a.slice(-4)}`;

/** Token names come from onchain metadata, so anyone can put markup in them. */
const escapeHtml = (v: string): string =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function explorerUrl(chain: string, txHash: string): string | null {
    if (chain === 'solana') return `https://solscan.io/tx/${txHash}`;
    if (chain === 'robinhood') return `https://explorer.mainnet.chain.robinhood.com/tx/${txHash}`;
    return null;
}


const MAX_ATTEMPTS = 4;
/** Longest we will wait on Telegram's retry_after, so one alert cannot outlast the sweep. */
const MAX_WAIT_MS = 10_000;

const realSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Deliver a message, retrying what a retry can actually fix.
 *
 * This matters more than it looks: the trade row is written before the alert
 * is sent, so if the send fails, every later sweep sees the row as a duplicate
 * and never tries again. A momentary Telegram hiccup would otherwise lose the
 * alert permanently, with the database looking perfectly correct.
 *
 * Retried: network errors and timeouts, 429 (waiting as long as Telegram asks),
 * and 5xx. Not retried: any other 4xx, which means the message itself is wrong
 * and will fail identically every time.
 *
 * `sleep` is injectable so the retry behaviour can be tested without waiting.
 */
export async function postToTelegram(body: string, sleep = realSleep): Promise<void> {
    let lastError = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const backoff = Math.min(MAX_WAIT_MS, 1000 * 2 ** (attempt - 1));
        let res: Response;

        try {
            res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: AbortSignal.timeout(15_000)
            });
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            if (attempt < MAX_ATTEMPTS) await sleep(backoff);
            continue;
        }

        if (res.ok) return;

        const text = await res.text();
        lastError = `${res.status} ${text}`;

        if (res.status === 429) {
            let retryAfterMs = backoff;
            try {
                const seconds = JSON.parse(text)?.parameters?.retry_after;
                if (typeof seconds === 'number') retryAfterMs = Math.min(MAX_WAIT_MS, seconds * 1000);
            } catch {
                // unparseable body: fall back to exponential backoff
            }
            if (attempt < MAX_ATTEMPTS) await sleep(retryAfterMs);
            continue;
        }

        if (res.status >= 500) {
            if (attempt < MAX_ATTEMPTS) await sleep(backoff);
            continue;
        }

        throw new Error(`Telegram rejected the message: ${lastError}`);
    }

    throw new Error(`Telegram send failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

export async function sendTradeAlert(trade: TradeRow): Promise<void> {
    const symbol = escapeHtml(trade.token_symbol || truncate(trade.token_address));
    const name = trade.token_name ? escapeHtml(trade.token_name) : null;

    const quote = trade.quote_symbol === 'SOL' || trade.quote_symbol === 'ETH'
        ? `${formatAmount(trade.quote_amount)} ${trade.quote_symbol}`
        : formatUsd(trade.usd_value);
    const usd = (trade.quote_symbol === 'SOL' || trade.quote_symbol === 'ETH') && trade.usd_value !== null
        ? ` (${formatUsd(trade.usd_value)})`
        : '';

    const lines = [
        `<b>${trade.side.toUpperCase()}</b> - ${escapeHtml(trade.wallet_label)}`,
        '',
        `<b>Token:</b> ${symbol}${name && name !== symbol ? ` (${name})` : ''}`,
        `<code>${trade.token_address}</code>`,
        '',
        `<b>Amount:</b> ${formatAmount(trade.token_amount)}`,
        `<b>${trade.side === 'buy' ? 'Paid' : 'Received'}:</b> ${quote}${usd}`,
        `<b>Price:</b> ${formatPrice(trade.price_usd)}`,
        '',
        `<b>Market:</b> ${escapeHtml(trade.dex || 'unknown')}`,
        `<b>Liquidity:</b> ${formatUsd(trade.liquidity_usd)}`,
        `<b>Market cap:</b> ${formatUsd(trade.market_cap_usd)}`
    ];

    const links = [
        { label: 'Explorer', url: explorerUrl(trade.chain, trade.tx_hash) },
        { label: 'DexScreener', url: trade.pair_url }
    ]
        .filter((l): l is { label: string; url: string } => Boolean(l.url))
        .map(l => `<a href="${l.url}">${l.label}</a>`)
        .join(' | ');
    if (links) lines.push('', links);

    await postToTelegram(JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: lines.join('\n'),
        parse_mode: 'HTML',
        disable_web_page_preview: true
    }));
}
