import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { withStandPage, gotoUI, waitToast } from './helpers.js';

describe('db-only delete and registry reset', () => {
    let stand;
    let browser;
    let stopEnv;

    before(async () => {
        ({ stand, browser, stop: stopEnv } = await withStandPage());
    });

    after(async () => {
        await stopEnv?.();
    });

    it('two clicks delete the gray row, first click only arms', async () => {
        const page = await gotoUI(browser, stand);

        const sel = '.config-row[data-key="zz/notes"] .delete-btn';
        await page.evaluate((s) => {
            document.querySelector(s).click();
        }, sel);
        await page.waitForFunction(
            () => !!document.querySelector('.config-row[data-key="zz/notes"] .delete-btn.armed'),
            undefined,
            { timeout: 5000 },
        );

        const armed = await page.evaluate(() => ({
            armed: !!document.querySelector('.config-row[data-key="zz/notes"] .delete-btn.armed'),
            rowGone: !document.querySelector('.config-row[data-key="zz/notes"]'),
        }));
        assert.equal(armed.armed, true);
        assert.equal(armed.rowGone, false);

        await page.evaluate((s) => {
            document.querySelector(s).click();
        }, sel);

        await waitToast(page, 'Key "zz/notes" deleted');
        await page.waitForFunction(
            () => !document.querySelector('.config-row[data-key="zz/notes"]'),
            undefined,
            { timeout: 10000 },
        );
        assert.deepEqual(browser.errors, []);
    });

    it('yellow code-only rows have no delete button, green rows reset to yellow on two clicks', async () => {
        const page = await gotoUI(browser, stand);

        const yellowHasBtn = await page.evaluate(
            () => !!document.querySelector('.config-row[data-key="app/missing/flag"] .delete-btn'),
        );
        assert.equal(yellowHasBtn, false);

        const sel = '.config-row[data-key="app/title"] .delete-btn';
        await page.evaluate((s) => {
            document.querySelector(s).click();
        }, sel);
        await page.waitForFunction(
            () => !!document.querySelector('.config-row[data-key="app/title"] .delete-btn.armed'),
            undefined,
            { timeout: 5000 },
        );

        await page.evaluate((s) => {
            document.querySelector(s).click();
        }, sel);

        await page.waitForFunction(
            () => document.querySelector('.config-row[data-key="app/title"]')?.classList.contains('state-yellow'),
            undefined,
            { timeout: 10000 },
        );
        assert.deepEqual(browser.errors, []);
    });
});
