import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { withStandPage, gotoUI } from './helpers.js';

// The scrim shields background content while the create card is open:
// no hover reactions, outside click only dismisses (draft kept),
// Cancel dismisses and wipes.
describe('create-card scrim', () => {
    let stand;
    let browser;
    let stopEnv;

    before(async () => {
        ({ stand, browser, stop: stopEnv } = await withStandPage());
    });

    after(async () => {
        await stopEnv?.();
    });

    it('background ignores hover while the card is open', async () => {
        const page = await gotoUI(browser, stand);

        const head = await page.$('.registry-group .registry-header');
        const hb = await head.boundingBox();
        const hx = hb.x + 40;
        const hy = hb.y + hb.height / 2;
        const bg = () => page.evaluate(
            () => getComputedStyle(document.querySelector('.registry-group .registry-header')).backgroundColor,
        );

        // Control: shut card, hover reacts.
        await page.mouse.move(700, 850);
        const restBg = await bg();
        await page.mouse.move(hx, hy);
        await page.waitForFunction(
            async (prev) => {
                const cur = getComputedStyle(document.querySelector('.registry-group .registry-header')).backgroundColor;
                return cur !== prev;
            },
            restBg,
            { timeout: 5000 },
        );

        await page.evaluate(() => {
            document.getElementById('createBtn').click();
        });
        await page.waitForFunction(
            () => document.getElementById('createWidget').classList.contains('expanded'),
            undefined,
            { timeout: 5000 },
        );

        const under = await page.evaluate(([x, y]) => {
            const el = document.elementFromPoint(x, y);
            return el ? el.id || el.className.slice(0, 20) : null;
        }, [hx, hy]);
        assert.equal(under, 'createScrim');

        // Open card: the same hover point must read exactly the rest color.
        await page.mouse.move(hx, hy);
        await page.waitForFunction(
            async (prev) => {
                const cur = getComputedStyle(document.querySelector('.registry-group .registry-header')).backgroundColor;
                return cur === prev;
            },
            restBg,
            { timeout: 5000 },
        );
        assert.deepEqual(browser.errors, []);
    });

    it('outside click dismisses keeping the draft, Cancel wipes it', async () => {
        const page = await gotoUI(browser, stand);

        await page.evaluate(() => {
            document.getElementById('createBtn').click();
        });
        await page.waitForFunction(
            () => document.getElementById('createWidget').classList.contains('expanded'),
            undefined,
            { timeout: 5000 },
        );
        await page.evaluate(() => {
            document.getElementById('createKey').value = 'e2e/draft/kept';
            document.getElementById('createKey').dispatchEvent(new Event('input', { bubbles: true }));
        });

        // Real click on background content (lands on the scrim).
        const hb = await (await page.$('.registry-group .registry-header')).boundingBox();
        await page.mouse.click(hb.x + 400, hb.y + hb.height / 2);
        await page.waitForFunction(
            () => !document.getElementById('createWidget').classList.contains('expanded'),
            undefined,
            { timeout: 5000 },
        );
        const scrimHidden = await page.evaluate(
            () => document.getElementById('createScrim').hasAttribute('hidden'),
        );
        assert.equal(scrimHidden, true);

        await page.evaluate(() => {
            document.getElementById('createBtn').click();
        });
        await page.waitForFunction(
            () => document.getElementById('createWidget').classList.contains('expanded'),
            undefined,
            { timeout: 5000 },
        );
        const kept = await page.evaluate(() => document.getElementById('createKey').value);
        assert.equal(kept, 'e2e/draft/kept');

        await page.evaluate(() => {
            document.getElementById('cancelCreateBtn').click();
        });
        await page.waitForFunction(
            () => !document.getElementById('createWidget').classList.contains('expanded'),
            undefined,
            { timeout: 5000 },
        );

        await page.evaluate(() => {
            document.getElementById('createBtn').click();
        });
        await page.waitForFunction(
            () => document.getElementById('createWidget').classList.contains('expanded'),
            undefined,
            { timeout: 5000 },
        );
        const wiped = await page.evaluate(() => document.getElementById('createKey').value);
        assert.equal(wiped, '');

        assert.deepEqual(browser.errors, []);
    });
});
