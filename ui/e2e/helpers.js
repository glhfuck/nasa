// Shared e2e plumbing: builds and boots the sqlite-backed demo stand on
// a free loopback port, hands out playwright pages. Every test file runs
// in its own process, so each boots an isolated stand (parallel-safe).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function waitForUI(url, timeoutMs = 30000) {
    const start = Date.now();
    for (;;) {
        try {
            const res = await fetch(url + '/ui');
            if (res.ok) return;
        } catch {
            // Not up yet.
        }
        if (Date.now() - start > timeoutMs) {
            throw new Error('e2e stand did not come up at ' + url);
        }
        await new Promise((r) => setTimeout(r, 200));
    }
}

// withStand builds ./ui/e2e/stand once per test file into a temp dir,
// boots it on a free port and waits for /ui. Returns { url, stop }.
//
// Port race: freePort releases before spawn, so a parallel test file can
// steal the port in between (TOCTOU). Boot retries with a fresh port
// instead of assuming the first pick survives.
export async function withStand() {
    const dir = mkdtempSync(join(tmpdir(), 'nasa-e2e-'));
    const bin = join(dir, 'e2e-stand');
    execFileSync('go', ['build', '-o', bin, '.'], { cwd: join(repoRoot, 'ui', 'e2e', 'stand'), stdio: 'pipe' });
    const stopDir = async () => {
        rmSync(dir, { recursive: true, force: true });
    };
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
        const port = await freePort();
        const proc = spawn(bin, ['-addr', `127.0.0.1:${port}`], { stdio: 'pipe' });
        const url = `http://127.0.0.1:${port}`;
        try {
            await waitForUI(url, 10000);
            return {
                url,
                stop: async () => {
                    proc.kill();
                    await new Promise((r) => setTimeout(r, 300));
                    await stopDir();
                },
            };
        } catch (err) {
            lastErr = err;
            proc.kill();
            await new Promise((r) => setTimeout(r, 300));
        }
    }
    await stopDir();
    throw lastErr;
}

export async function withBrowserPage() {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err && err.message || err)));
    return {
        page,
        errors,
        close: async () => {
            await browser.close();
        },
    };
}

// gotoUI loads a fresh panel: per-test navigation so DOM state (open
// editors, drafts, toasts) never leaks between tests in a file.
// (The sqlite DB is per file-run; tests sharing rows must not depend
// on each other's writes — use self-contained values instead.)
export async function gotoUI(browser, stand) {
    const page = browser.page;
    await page.goto(stand.url + '/ui', { waitUntil: 'networkidle' });
    await page.waitForSelector('.registry-group', { timeout: 15000 });
    // Reset the error ledger: stale pageerrors would fail later tests too.
    browser.errors.length = 0;
    return page;
}

// waitToast waits for an exact toast text instead of a fixed sleep.
export async function waitToast(page, text, timeout = 10000) {
    await page.waitForFunction(
        (t) => document.getElementById('toast')?.textContent === t,
        text,
        { timeout },
    );
}

// withStandPage boots one isolated stand + browser for a test file.
// Bodies keep using stand/browser directly; after() only stops.
export async function withStandPage() {
    const stand = await withStand();
    const browser = await withBrowserPage();
    return {
        stand,
        browser,
        stop: async () => {
            await browser?.close();
            await stand?.stop();
        },
    };
}
