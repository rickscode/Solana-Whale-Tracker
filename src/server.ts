import * as http from 'http';
import { PORT } from './config/constants';
import { logger } from './utils/logger';

let lastCycleAt: number | null = null;
let lastCycleOk = false;

export function recordCycle(ok: boolean): void {
    lastCycleAt = Date.now();
    lastCycleOk = ok;
}

/**
 * A health endpoint, needed only because free hosting offers web services
 * rather than background workers: without a bound port there is nothing to
 * deploy to, and without inbound traffic the host puts the service to sleep.
 *
 * Deliberately says nothing about which wallets are tracked - it is a public
 * URL, and the wallet list is the whole point of the tool.
 */
export function startHealthServer(): void {
    const server = http.createServer((req, res) => {
        // Any path answers: the host's health check and the keep-alive pinger
        // may not agree on which one to use.
        const stale = lastCycleAt !== null && Date.now() - lastCycleAt > STALE_AFTER_MS;
        const healthy = lastCycleAt !== null && lastCycleOk && !stale;

        // Always 200. The host restarts a service that fails its health check,
        // and a transient rate limit on one cycle is no reason to kill a
        // process that is otherwise fine - the status is in the body to read.
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
        });
        res.end(JSON.stringify({
            status: lastCycleAt === null ? 'starting' : healthy ? 'ok' : 'degraded',
            uptimeSeconds: Math.floor(process.uptime()),
            secondsSinceLastCycle: lastCycleAt === null ? null : Math.floor((Date.now() - lastCycleAt) / 1000)
        }));
        req.resume();
    });

    server.on('error', error => logger.error('Health server error:', error));
    server.listen(PORT, () => logger.info(`Health endpoint listening on :${PORT}`));
}

/** A cycle taking this long means polling has stalled. */
const STALE_AFTER_MS = 10 * 60 * 1000;
