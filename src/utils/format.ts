export function formatUsd(amount: number | null): string {
    if (amount === null || !Number.isFinite(amount)) {
        return 'n/a';
    }
    const abs = Math.abs(amount);
    if (abs >= 1_000_000) {
        return `$${(amount / 1_000_000).toFixed(2)}M`;
    }
    if (abs >= 1_000) {
        return `$${(amount / 1_000).toFixed(2)}K`;
    }
    return `$${amount.toFixed(2)}`;
}

/** Memecoin prices run to many leading zeros, so significant digits beat fixed decimals. */
export function formatPrice(price: number | null): string {
    if (price === null || !Number.isFinite(price)) {
        return 'n/a';
    }
    return price >= 1 ? `$${price.toFixed(4)}` : `$${price.toPrecision(4)}`;
}

export function formatAmount(amount: number): string {
    return amount.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function truncate(address: string): string {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/** Token names come from onchain metadata, so anyone can put markup in them. */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
