import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createPendingToggles, UNDO_DELAY_MS } from './pending.js';
import { fakeClock } from './fake-clock.js';

function harness({ commitImpl = async () => {}, clock = fakeClock() } = {}) {
    const calls = { commit: [], revert: [], fail: [] };
    const pending = createPendingToggles({
        clock,
        commit: async (key, value) => {
            calls.commit.push([key, value]);
            await commitImpl(key, value);
        },
        revert: (key, original) => { calls.revert.push([key, original]); },
        fail: (key, original, err) => { calls.fail.push([key, original, String(err)]); },
    });
    return { clock, calls, pending };
}

describe('pending toggles', () => {
    it('commits the staged value after the delay, not before', async () => {
        const { clock, calls, pending } = harness();
        assert.equal(pending.stage('k', false, true), 'pending');
        await clock.advance(UNDO_DELAY_MS - 1);
        assert.deepEqual(calls.commit, []);
        await clock.advance(1);
        assert.deepEqual(calls.commit, [['k', true]]);
    });

    it('undo cancels the commit and reverts the UI', async () => {
        const { clock, calls, pending } = harness();
        pending.stage('k', false, true);
        assert.equal(pending.undo('k'), true);
        await clock.advance(UNDO_DELAY_MS + 1);
        assert.deepEqual(calls.commit, []);
        assert.deepEqual(calls.revert, [['k', false]]);
    });

    it('spam clicks keep only the last state and one commit', async () => {
        const { clock, calls, pending } = harness();
        pending.stage('k', false, true);
        await clock.advance(1000);
        pending.stage('k', false, false);
        await clock.advance(1000);
        pending.stage('k', false, true);
        assert.equal(clock.pendingCount(), 1);
        await clock.advance(UNDO_DELAY_MS);
        assert.deepEqual(calls.commit, [['k', true]]);
    });

    it('staging back to the original is a noop (no commit, UI synced)', async () => {
        const { clock, calls, pending } = harness();
        pending.stage('k', false, true);
        assert.equal(pending.stage('k', false, false), 'noop');
        await clock.advance(UNDO_DELAY_MS + 1);
        assert.deepEqual(calls.commit, []);
        assert.deepEqual(calls.revert, [['k', false]]);
    });

    it('failed commit reverts and reports without rethrowing', async () => {
        const { clock, calls, pending } = harness({
            commitImpl: async () => { throw new Error('500 Server Error'); },
        });
        pending.stage('k', false, true);
        await clock.advance(UNDO_DELAY_MS);
        assert.deepEqual(calls.commit, [['k', true]]);
        assert.deepEqual(calls.revert, [['k', false]]);
        assert.equal(calls.fail.length, 1);
        assert.equal(calls.fail[0][0], 'k');
        assert.equal(calls.fail[0][1], false);
        assert.match(calls.fail[0][2], /500/);
    });

    it('flushAll commits everything immediately', async () => {
        const { clock, calls, pending } = harness();
        pending.stage('a', false, true);
        pending.stage('b', true, false);
        await pending.flushAll();
        assert.deepEqual(calls.commit, [['a', true], ['b', false]]);
        assert.equal(clock.pendingCount(), 0);
    });

    it('undo and fire on unknown keys are silent no-ops', async () => {
        const { calls, pending } = harness();
        assert.equal(pending.undo('missing'), false);
        assert.equal(await pending.fire('missing'), false);
        assert.deepEqual(calls.commit, []);
        assert.deepEqual(calls.revert, []);
        assert.deepEqual(calls.fail, []);
    });
});
