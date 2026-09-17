// Retry behaviour for Telegram delivery, run against a fake Telegram.
// A failed send is never retried by the sweep - the trade row already exists -
// so these rules are the only thing standing between a hiccup and a lost alert.
// Run with: npm run test:functions

import { postToTelegram } from '../supabase/functions/_shared/telegram.ts';

type Step = { status?: number; body?: string; throws?: string };
let failed = 0;

async function run(name: string, steps: Step[], expect: { ok: boolean; calls: number; sleeps: number[]; errorIncludes?: string }) {
    let calls = 0;
    const sleeps: number[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
        const step = steps[Math.min(calls, steps.length - 1)];
        calls++;
        if (step.throws) return Promise.reject(new Error(step.throws));
        return Promise.resolve(new Response(step.body ?? '{}', { status: step.status ?? 200 }));
    }) as typeof fetch;

    let ok = true, err = '';
    try { await postToTelegram('{}', (ms) => { sleeps.push(ms); return Promise.resolve(); }); }
    catch (e) { ok = false; err = e instanceof Error ? e.message : String(e); }
    finally { globalThis.fetch = realFetch; }

    const pass = ok === expect.ok && calls === expect.calls
        && JSON.stringify(sleeps) === JSON.stringify(expect.sleeps)
        && (!expect.errorIncludes || err.includes(expect.errorIncludes));
    console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name.padEnd(42)} calls=${calls} waits=[${sleeps.join(',')}]${ok ? '' : '  -> ' + err.slice(0, 50)}`);
    if (!pass) { failed++; console.log(`       expected ok=${expect.ok} calls=${expect.calls} waits=[${expect.sleeps.join(',')}]`); }
}

await run('delivers first time',                  [{ status: 200 }],                                         { ok: true,  calls: 1, sleeps: [] });
await run('429 then ok: waits retry_after (3s)',  [{ status: 429, body: '{"parameters":{"retry_after":3}}' }, { status: 200 }], { ok: true, calls: 2, sleeps: [3000] });
await run('429 asks 60s: capped at 10s',          [{ status: 429, body: '{"parameters":{"retry_after":60}}' }, { status: 200 }], { ok: true, calls: 2, sleeps: [10000] });
await run('500 then ok: backs off 1s',            [{ status: 500 }, { status: 200 }],                        { ok: true,  calls: 2, sleeps: [1000] });
await run('network error then ok',                [{ throws: 'connection reset' }, { status: 200 }],         { ok: true,  calls: 2, sleeps: [1000] });
await run('two failures then ok: 1s, 2s',         [{ status: 502 }, { status: 503 }, { status: 200 }],       { ok: true,  calls: 3, sleeps: [1000, 2000] });
await run('400 bad message: no retry',            [{ status: 400, body: 'bad html' }],                       { ok: false, calls: 1, sleeps: [], errorIncludes: 'rejected' });
await run('always 500: gives up after 4',         [{ status: 500 }],                                         { ok: false, calls: 4, sleeps: [1000, 2000, 4000], errorIncludes: 'after 4 attempts' });

console.log(failed ? `\n${failed} FAILED` : '\nALL RETRY CASES PASS');
Deno.exit(failed ? 1 : 0);
