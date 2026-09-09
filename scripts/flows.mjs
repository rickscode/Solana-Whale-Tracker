// Where capital moved, and when.
//
//   npm run flows            last 5 hours
//   npm run flows -- 24      last 24 hours
//   npm run flows -- 5 ZCAT  plus a distribution breakdown for one token
//
// Times are Europe/London, which follows BST/GMT automatically.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
    readFileSync('.env', 'utf-8').split('\n')
        .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const hours = Number(process.argv[2] ?? 5);
const focusToken = process.argv[3] ?? null;
const TZ = 'Europe/London';
const since = new Date(Date.now() - hours * 3600_000).toISOString();

const q = async (path) => {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
    });
    if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`);
    return res.json();
};

const money = (n) => n.toLocaleString('en-GB', { maximumFractionDigits: 0 });
const signed = (n) => (n >= 0 ? '+' : '') + money(n);
const hhmm = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);
const tzName = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, timeZoneName: 'short' })
    .formatToParts(new Date()).find(p => p.type === 'timeZoneName').value;

const rows = await q(
    'whale_trades?select=block_time,chain,wallet_label,side,token_symbol,token_address,usd_value,price_usd,liquidity_usd'
    + `&block_time=gte.${encodeURIComponent(since)}&order=block_time&limit=5000`
);
const priced = rows.filter(r => r.usd_value !== null);

console.log(`\nWHALE CAPITAL FLOW - last ${hours}h to ${hhmm(new Date())} ${tzName}`);
console.log(`${rows.length} trades, ${priced.length} priced, ${rows.length - priced.length} unpriced\n`);

const bucket = (key, r, map) => {
    const e = map.get(key) ?? { n: 0, buy: 0, sell: 0, who: new Set(), chain: r.chain };
    e.n++; e[r.side] += Number(r.usd_value); e.who.add(r.wallet_label);
    map.set(key, e); return e;
};

// by hour
const byHour = new Map();
for (const r of priced) {
    const d = new Date(r.block_time);
    bucket(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d), r, byHour);
}
console.log(`${'HOUR (' + tzName + ')'.padEnd(8)}   TRADES        BOUGHT          SOLD           NET`);
console.log('-'.repeat(62));
let tb = 0, ts = 0;
for (const h of [...byHour.keys()].sort()) {
    const e = byHour.get(h); tb += e.buy; ts += e.sell;
    console.log(`  ${h}:00      ${String(e.n).padStart(6)} ${money(e.buy).padStart(13)} ${money(e.sell).padStart(13)} ${signed(e.sell - e.buy).padStart(13)}`);
}
console.log('-'.repeat(62));
console.log(`  TOTAL        ${String(priced.length).padStart(6)} ${money(tb).padStart(13)} ${money(ts).padStart(13)} ${signed(ts - tb).padStart(13)}`);

const table = (title, map, cols = ['BOUGHT', 'SOLD', 'NET']) => {
    console.log(`\n${title.padEnd(14)} TRADES        BOUGHT          SOLD           NET`);
    console.log('-'.repeat(62));
    for (const [k, e] of [...map].sort((a, b) => (b[1].buy + b[1].sell) - (a[1].buy + a[1].sell)).slice(0, 12)) {
        console.log(`  ${String(k).slice(0, 12).padEnd(12)} ${String(e.n).padStart(6)} ${money(e.buy).padStart(13)} ${money(e.sell).padStart(13)} ${signed(e.sell - e.buy).padStart(13)}`);
    }
};

const byWallet = new Map(); for (const r of priced) bucket(r.wallet_label, r, byWallet);
table('WALLET', byWallet);
const byChain = new Map(); for (const r of priced) bucket(r.chain, r, byChain);
table('CHAIN', byChain);
const byToken = new Map(); for (const r of priced) bucket(r.token_symbol ?? r.token_address.slice(0, 8), r, byToken);
table('TOKEN', byToken);

// optional: how a single position was distributed
if (focusToken) {
    const t = rows.filter(r => r.token_symbol === focusToken && r.side === 'sell' && r.usd_value !== null);
    if (t.length === 0) { console.log(`\nno priced sells of ${focusToken} in this window`); }
    else {
        const vals = t.map(r => Number(r.usd_value)).sort((a, b) => a - b);
        const liq = t.map(r => Number(r.liquidity_usd)).filter(Boolean).sort((a, b) => a - b);
        const med = (a) => a[Math.floor(a.length / 2)];
        const total = vals.reduce((s, v) => s + v, 0);
        console.log(`\n${focusToken} DISTRIBUTION`);
        console.log('-'.repeat(62));
        console.log(`  sells              ${t.length}`);
        console.log(`  total sold         ${money(total)}`);
        console.log(`  median sell        ${money(med(vals))}`);
        if (liq.length) {
            console.log(`  pool liquidity     ${money(med(liq))}`);
            console.log(`  median sell / pool ${(100 * med(vals) / med(liq)).toFixed(2)}%`);
            console.log(`  position / pool    ${(100 * total / med(liq)).toFixed(0)}%   <- why it is sliced`);
        }
        const gaps = t.slice(1).map((r, i) => (new Date(r.block_time) - new Date(t[i].block_time)) / 1000).sort((a, b) => a - b);
        if (gaps.length) console.log(`  median gap         ${med(gaps).toFixed(0)}s`);
        const px = t.map(r => Number(r.price_usd)).filter(Boolean);
        if (px.length > 4) {
            const k = Math.max(1, Math.floor(px.length / 5));
            const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
            console.log(`  price drift        ${(100 * (avg(px.slice(-k)) / avg(px.slice(0, k)) - 1)).toFixed(1)}%`);
        }
    }
}
console.log();
