import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { withStandPage, gotoUI, waitToast } from './helpers.js';

// Row inline editor: change a value, Save opens review, Commit persists;
// invalid JSON toasts without saving. Each test navigates fresh and sets
// up its own values (the sqlite DB lives for the whole file-run).
describe('row inline edit', () => {
    let stand;
    let browser;
    let stopEnv;

    before(async () => {
        ({ stand, browser, stop: stopEnv } = await withStandPage());
    });

    after(async () => {
        await stopEnv?.();
    });

    async function openEditor(page, key) {
        await page.evaluate((k) => {
            document.querySelector(`.config-row[data-key="${k}"]`).click();
        }, key);
        await page.waitForFunction(
            (k) => !!document.querySelector(`.config-row[data-key="${k}"].editing`),
            key,
            { timeout: 5000 },
        );
    }

    async function setEditor(page, key, text) {
        await page.evaluate(([k, t]) => {
            const input = document.getElementById(`input-${k}`);
            input.textContent = t;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }, [key, text]);
    }

    it('saves a new title and re-renders the cell', async () => {
        const page = await gotoUI(browser, stand);
        const key = 'app/title';
        await openEditor(page, key);
        await setEditor(page, key, '"world"');
        await page.evaluate((k) => {
            document.querySelector(`.edit-form[data-key="${k}"] button[type="submit"]`).click();
        }, key);
        await page.waitForSelector(`.edit-form[data-key="${key}"] .commit-review:not([hidden])`, { timeout: 5000 });
        await page.evaluate((k) => {
            document.querySelector(`.edit-form[data-key="${k}"] [data-action="commit"]`).click();
        }, key);

        await waitToast(page, 'Config "app/title" updated successfully');
        const cell = await page.evaluate(
            () => document.querySelector('.config-row[data-key="app/title"] .config-value')?.textContent,
        );
        assert.ok(cell.includes('world'));
        assert.deepEqual(browser.errors, []);
    });

    it('Save opens review showing was and became', async () => {
        const page = await gotoUI(browser, stand);
        const key = 'app/title';
        const before = await page.evaluate(
            () => document.querySelector('.config-row[data-key="app/title"] .config-value')?.textContent,
        );
        await openEditor(page, key);
        await setEditor(page, key, '"review-me"');
        await page.evaluate((k) => {
            document.querySelector(`.edit-form[data-key="${k}"] button[type="submit"]`).click();
        }, key);

        await page.waitForSelector(`.edit-form[data-key="${key}"] .commit-review:not([hidden])`, { timeout: 5000 });
        const state = await page.evaluate(() => ({
            was: document.querySelector('.edit-form[data-key="app/title"] .diff-was')?.textContent,
            became: document.querySelector('.edit-form[data-key="app/title"] .diff-became')?.textContent,
            hasBack: !!document.querySelector('.edit-form[data-key="app/title"] [data-action="back"]'),
            hasCommit: !!document.querySelector('.edit-form[data-key="app/title"] [data-action="commit"]'),
        }));
        assert.equal(state.was.trim(), before.trim());
        assert.ok(state.became.includes('review-me'));
        assert.equal(state.hasBack, true);
        assert.equal(state.hasCommit, true);

        await page.evaluate(() => {
            document.querySelector('.edit-form[data-key="app/title"] [data-action="back"]').click();
        });
        await page.waitForFunction(
            () => document.querySelector('.edit-form[data-key="app/title"] .commit-review').hasAttribute('hidden'),
            undefined,
            { timeout: 5000 },
        );
        assert.deepEqual(browser.errors, []);
    });

    it('Save is disabled without changes', async () => {
        const page = await gotoUI(browser, stand);
        const key = 'app/title';
        await openEditor(page, key);
        const disabled = await page.evaluate(
            (k) => document.querySelector(`.edit-form[data-key="${k}"] button[type="submit"]`).disabled,
            key,
        );
        assert.equal(disabled, true);
        assert.deepEqual(browser.errors, []);
    });

    it('invalid JSON toasts and keeps the editor open', async () => {
        const page = await gotoUI(browser, stand);
        const key = 'app/title';
        await openEditor(page, key);
        await setEditor(page, key, '{bad');
        await page.evaluate((k) => {
            document.querySelector(`.edit-form[data-key="${k}"] button[type="submit"]`).click();
        }, key);

        await page.waitForFunction(
            () => document.getElementById('toast')?.textContent?.startsWith('Invalid JSON'),
            undefined,
            { timeout: 5000 },
        );
        const editing = await page.evaluate(
            () => !!document.querySelector('.config-row[data-key="app/title"].editing'),
        );
        assert.equal(editing, true);
        assert.deepEqual(browser.errors, []);
    });
});
