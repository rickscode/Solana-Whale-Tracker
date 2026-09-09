-- Whale Tracker schema
-- Run this once in the Supabase SQL Editor of a fresh project.

create table if not exists wallets (
    id        bigint generated always as identity primary key,
    chain     text not null default 'solana',
    address   text not null,
    label     text not null,
    is_active boolean not null default true,
    added_at  timestamptz not null default now(),
    unique (chain, address)
);

create table if not exists whale_trades (
    id              bigint generated always as identity primary key,
    chain           text not null default 'solana',
    wallet_address  text not null,
    wallet_label    text not null,
    side            text not null check (side in ('buy', 'sell')),
    tx_hash         text not null,

    -- what was traded
    token_address   text not null,
    token_symbol    text,
    token_name      text,
    token_amount    numeric(38, 10) not null,

    -- what it cost / returned
    quote_symbol    text,
    quote_amount    numeric(38, 18),
    usd_value       numeric(20, 2),
    price_usd       numeric(36, 18),

    -- market context at detection time
    dex             text,
    liquidity_usd   numeric(20, 2),
    market_cap_usd  numeric(20, 2),
    pair_url        text,

    -- your call on it
    status          text not null default 'new'
                    check (status in ('new', 'skipped', 'copied')),

    block_time      timestamptz not null,
    detected_at     timestamptz not null default now(),
    raw             jsonb,

    -- this constraint IS the dedup mechanism; inserts are upsert-ignore
    unique (chain, tx_hash, wallet_address, token_address)
);

create index if not exists idx_trades_block_time on whale_trades (block_time desc);
create index if not exists idx_trades_wallet_token on whale_trades (chain, wallet_address, token_address);
create index if not exists idx_trades_new on whale_trades (status) where status = 'new';

-- The bot connects with the service_role key, which bypasses RLS.
-- Enabling RLS with no policies keeps the anon key from reaching this data.
alter table wallets enable row level security;
alter table whale_trades enable row level security;

-- Wallet being tracked
insert into wallets (chain, address, label)
values ('solana', '4UrFSCrGxgoCtCUBAEZq7ZmPK3Pczkxx7PwYnkBMi1KR', 'J777')
on conflict (chain, address) do nothing;
