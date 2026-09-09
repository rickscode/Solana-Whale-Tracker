// Points the Helius webhook at every active Solana wallet in the database.
//
// Adding a wallet needs this as well as the row: without it the new wallet is
// only picked up by the 5-minute sweep, not in real time.
//
// The free plan allows one webhook, so this refuses to touch an existing one
// that is not ours unless --force is passed.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
    readFileSync('.env', 'utf-8').split('\n')
        .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const need = ['HELIUS_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'WEBHOOK_SECRET'];
const missing = need.filter(k => !env[k]);
if (missing.length) {
    console.error(`missing from .env: ${missing.join(', ')}`);
    console.error('WEBHOOK_SECRET must match the one set via `supabase secrets set`.');
    process.exit(1);
}

const ref = new URL(env.SUPABASE_URL).hostname.split('.')[0];
const target = `https://${ref}.supabase.co/functions/v1/whale-webhook`;
const force = process.argv.includes('--force');

const rest = async (path) => {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
    });
    if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`);
    return res.json();
};

const wallets = await rest('wallets?select=address,label&chain=eq.solana&is_active=is.true');
const addresses = wallets.map(w => w.address);
if (addresses.length === 0) {
    console.error('no active solana wallets');
    process.exit(1);
}
console.log(`${addresses.length} solana wallets: ${wallets.map(w => w.label).join(', ')}`);

const hook = async (path, init) => {
    const res = await fetch(`https://api.helius.xyz/v0/webhooks${path}${path.includes('?') ? '&' : '?'}api-key=${env.HELIUS_API_KEY}`, init);
    if (!res.ok) throw new Error(`helius ${res.status}: ${await res.text()}`);
    return res.json();
};

const existing = await hook('', {});
const ours = existing.find(w => w.webhookURL === target);
const body = {
    webhookURL: target,
    transactionTypes: ['SWAP'],
    accountAddresses: addresses,
    webhookType: 'enhanced',
    authHeader: env.WEBHOOK_SECRET
};

if (ours) {
    await hook(`/${ours.webhookID}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    console.log(`updated webhook ${ours.webhookID} -> ${addresses.length} addresses`);
} else if (existing.length > 0 && !force) {
    console.error(`\nThe free plan allows one webhook and this account already has ${existing.length}:`);
    for (const w of existing) console.error(`  ${w.webhookID}  ${w.webhookURL}  active=${w.active}`);
    console.error('\nThat webhook belongs to something else. Re-run with --force to replace it.');
    process.exit(1);
} else {
    for (const w of existing) {
        await hook(`/${w.webhookID}`, { method: 'DELETE' });
        console.log(`deleted webhook ${w.webhookID} (${w.webhookURL})`);
    }
    const created = await hook('', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    console.log(`created webhook ${created.webhookID} -> ${addresses.length} addresses`);
}
console.log(`target: ${target}`);
