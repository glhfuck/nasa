import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { withStandPage, gotoUI, waitToast } from './helpers.js';

describe('create-key flow', () => {
    let stand;
    let browser;
    let stopEnv;

    before(async () => {
        ({ stand, browser, stop: stopEnv } = await withStandPage());
    });

    after(async () => {
        await stopEnv?.();
    });

    async function openCard(page) {
        await page.evaluate(() => {
            if (!document.getElementById('createWidget').classList.contains('expanded')) {
                document.getElementById('createBtn').click();
            }
        });
        await page.waitForFunction(
            () => document.getElementById('createWidget').classList.contains('expanded'),
            undefined,
            { timeout: 5000 },
        );
    }

    async function setValue(page, text) {
        await page.evaluate((t) => {
            const v = document.getElementById('createValue');
            v.textContent = t;
            v.dispatchEvent(new InputEvent('input', { bubbles: true }));
        }, text);
        await page.waitForFunction(
            (t) => document.getElementById('createValue').textContent === t,
            text,
            { timeout: 5000 },
        );
    }

    it('creates a key through the card: toast plus new row', async () => {
        const page = await gotoUI(browser, stand);
        await openCard(page);
        await page.evaluate(() => {
            document.getElementById('createKey').value = 'e2e/smoke/flag';
            document.getElementById('createKey').dispatchEvent(new Event('input', { bubbles: true }));
        });
        await setValue(page, 'true');
        await page.evaluate(() => {
            document.querySelector('#createForm button[type="submit"]').click();
        });

        await waitToast(page, 'Key "e2e/smoke/flag" created');
        await page.waitForSelector('.config-row[data-key="e2e/smoke/flag"]', { timeout: 10000 });
        assert.deepEqual(browser.errors, []);
    });

    it('invalid submit toasts and paints the bad field, button stays clickable', async () => {
        const page = await gotoUI(browser, stand);
        await openCard(page);
        await page.evaluate(() => {
            document.querySelector('#createForm button[type="submit"]').click();
        });

        await waitToast(page, 'Key required');
        const state = await page.evaluate(() => ({
            disabled: document.querySelector('#createForm button[type="submit"]').disabled,
            keyErr: document.getElementById('createKey').classList.contains('error'),
        }));
        assert.equal(state.disabled, false);
        assert.equal(state.keyErr, true);
        assert.deepEqual(browser.errors, []);
    });

    it('duplicate key toasts without creating', async () => {
        const page = await gotoUI(browser, stand);
        await openCard(page);
        await page.evaluate(() => {
            document.getElementById('createKey').value = 'app/title';
            document.getElementById('createKey').dispatchEvent(new Event('input', { bubbles: true }));
        });
        await setValue(page, '"x"');
        await page.evaluate(() => {
            document.querySelector('#createForm button[type="submit"]').click();
        });

        await waitToast(page, 'Key "app/title" already exists');
        assert.deepEqual(browser.errors, []);
    });
});
