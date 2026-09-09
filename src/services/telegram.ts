import TelegramBot from 'node-telegram-bot-api';
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from '../config/constants';
import { TradeRow } from '../types';
import { escapeHtml, formatAmount, formatPrice, formatUsd, truncate } from '../utils/format';
import { logger } from '../utils/logger';

let bot: TelegramBot | null = null;

function getBot(): TelegramBot {
    if (!bot) {
        bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
    }
    return bot;
}

function explorerUrl(chain: string, txHash: string): string | null {
    return chain === 'solana' ? `https://solscan.io/tx/${txHash}` : null;
}

export async function sendTradeAlert(trade: TradeRow): Promise<void> {
    const symbol = escapeHtml(trade.token_symbol || truncate(trade.token_address));
    const name = trade.token_name ? escapeHtml(trade.token_name) : null;

    // For a SOL-denominated trade the SOL amount is the useful number and the
    // dollar figure is context; otherwise the dollar figure is the whole story.
    const quote =
        trade.quote_symbol === 'SOL'
            ? `${formatAmount(trade.quote_amount)} SOL`
            : formatUsd(trade.usd_value);
    const usd =
        trade.quote_symbol === 'SOL' && trade.usd_value !== null
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
        .filter((link): link is { label: string; url: string } => Boolean(link.url))
        .map(link => `<a href="${link.url}">${link.label}</a>`)
        .join(' | ');

    if (links) {
        lines.push('', links);
    }

    await getBot().sendMessage(TELEGRAM_CHAT_ID, lines.join('\n'), {
        parse_mode: 'HTML',
        disable_web_page_preview: true
    });
}

export async function testConnection(): Promise<boolean> {
    try {
        const me = await getBot().getMe();
        logger.info(`Telegram connected: @${me.username}`);
        return true;
    } catch (error) {
        logger.error('Telegram connection failed:', error instanceof Error ? error.message : error);
        return false;
    }
}
