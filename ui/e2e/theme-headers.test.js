import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { withStandPage, gotoUI } from './helpers.js';

// Theme flips atomically (no per-element ripple) and header counters
// follow collapse state: hidden when expanded, shown when collapsed.
describe('theme and header counters', () => {
    let stand;
    let browser;
    let stopEnv;

    before(async () => {
        ({ stand, browser, stop: stopEnv } = await withStandPage());
    });

    after(async () => {
        await stopEnv?.();
    });

    it('theme toggle flips at once and restores transitions', async () => {
        const page = await gotoUI(browser, stand);

        const state = await page.evaluate(async () => {
            const root = document.documentElement;
            const wasDark = root.dataset.theme === 'dark';
            const probe = (sel) => {
                const el = document.querySelector(sel);
                return el ? getComputedStyle(el).transitionDuration : null;
            };
            document.getElementById('themeBtn').click();
            const out = {
                flipped: (root.dataset.theme === 'dark') !== wasDark,
                duringBtn: probe('#themeBtn'),
                duringHeader: probe('.registry-header'),
            };
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            out.settled = !root.classList.contains('theme-switch');
            out.afterBtn = probe('#themeBtn');
            return out;
        });

        assert.equal(state.flipped, true);
        assert.equal(state.duringBtn, '0s');
        assert.equal(state.duringHeader, '0s');
        assert.equal(state.settled, true);
        assert.notEqual(state.afterBtn, '0s');
        assert.deepEqual(browser.errors, []);
    });

    it('group counter hides expanded, shows collapsed', async () => {
        const page = await gotoUI(browser, stand);
        const visible = (sel) => page.evaluate(
            (s) => {
                const el = document.querySelector(s);
                return el ? getComputedStyle(el).display !== 'none' : null;
            },
            sel,
        );

        assert.equal(await visible('.registry-group:not(.collapsed) .registry-header .registry-count'), false);

        await page.evaluate(() => document.querySelector('.registry-group .registry-header').click());
        await page.waitForFunction(
            () => !!document.querySelector('.registry-group.collapsed'),
            undefined,
            { timeout: 5000 },
        );
        assert.equal(await visible('.registry-group.collapsed .registry-header .registry-count'), true);

        await page.evaluate(() => document.querySelector('.registry-group.collapsed .registry-header').click());
        await page.waitForFunction(
            () => !!document.querySelector('.registry-group:not(.collapsed)'),
            undefined,
            { timeout: 5000 },
        );
        assert.equal(await visible('.registry-group:not(.collapsed) .registry-header .registry-count'), false);
        assert.deepEqual(browser.errors, []);
    });

    it('folder counter hides expanded, shows collapsed', async () => {
        const page = await gotoUI(browser, stand);
        await page.evaluate(() => document.querySelector('.folder-header').click());
        await page.waitForFunction(
            () => !!document.querySelector('.tree-folder:not(.collapsed)'),
            undefined,
            { timeout: 5000 },
        );
        const expanded = await page.evaluate(() => {
            const el = document.querySelector('.tree-folder:not(.collapsed) > .folder-header .registry-count');
            return el ? getComputedStyle(el).display !== 'none' : null;
        });
        assert.equal(expanded, false);

        await page.evaluate(() => document.querySelector('.tree-folder:not(.collapsed) > .folder-header').click());
        await page.waitForFunction(
            () => !!document.querySelector('.tree-folder.collapsed > .folder-header'),
            undefined,
            { timeout: 5000 },
        );
        const collapsed = await page.evaluate(() => {
            const el = document.querySelector('.tree-folder.collapsed > .folder-header .registry-count');
            return el ? getComputedStyle(el).display !== 'none' : null;
        });
        assert.equal(collapsed, true);
        assert.deepEqual(browser.errors, []);
    });
});
