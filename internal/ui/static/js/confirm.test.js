import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ARM_MS, createArmedAction } from './confirm.js';
import { fakeClock } from './fake-clock.js';

describe('armed action (two-click confirm)', () => {
    it('first click arms, second click fires', () => {
        const arm = createArmedAction({ clock: fakeClock() });
        assert.equal(arm.click('k'), 'armed');
        assert.equal(arm.isArmed('k'), true);
        assert.equal(arm.click('k'), 'fired');
        assert.equal(arm.isArmed('k'), false);
    });

    it('disarms on timeout so the next click re-arms', async () => {
        const clock = fakeClock();
        const arm = createArmedAction({ clock });
        assert.equal(arm.click('k'), 'armed');
        await clock.advance(ARM_MS);
        assert.equal(arm.isArmed('k'), false);
        assert.equal(arm.click('k'), 'armed');
    });

    it('tracks keys independently', () => {
        const arm = createArmedAction({ clock: fakeClock() });
        assert.equal(arm.click('a'), 'armed');
        assert.equal(arm.click('b'), 'armed');
        assert.equal(arm.click('a'), 'fired');
        assert.equal(arm.isArmed('b'), true);
    });

    it('notifies on timeout expiry', async () => {
        const clock = fakeClock();
        const expired = [];
        const arm = createArmedAction({ clock, onExpire: (key) => expired.push(key) });
        arm.click('k');
        await clock.advance(ARM_MS);
        assert.deepEqual(expired, ['k']);
    });
});
