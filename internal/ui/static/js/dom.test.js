import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './dom-harness.js';
import { showToast, copyText, showUndoToast } from './dom.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
    installDom();
});

describe('showToast', () => {
    it('shows the latest message', () => {
        showToast('hello', 'success');
        const toast = document.getElementById('toast');
        assert.equal(toast.textContent, 'hello');
        assert.ok(toast.classList.contains('show'));
    });

    it('a second toast resets the hide timer instead of being cut off', async () => {
        showToast('first', 'info');
        await sleep(200);
        showToast('second', 'info');
        // The first toast's 3s timer has fired by now; the second toast
        // (rearmed at +200ms) must still be showing.
        await sleep(2950);
        const toast = document.getElementById('toast');
        assert.equal(toast.textContent, 'second');
        assert.ok(toast.classList.contains('show'));
    });
});

describe('copyText', () => {
    it('toasts an error when the clipboard is unavailable', async () => {
        // Node's navigator has no clipboard: must take the catch path.
        await copyText('x', 'Copied!');
        assert.equal(document.getElementById('toast').textContent, 'Failed to copy');
    });
});

describe('showUndoToast', () => {
    it('runs the action and dismisses on click', () => {
        let acted = 0;
        const dismiss = showUndoToast({
            message: 'Undone?', actionLabel: 'Undo', durationMs: 60000,
            onAction: () => { acted += 1; },
        });
        const btn = document.querySelector('#undo-toasts button');
        btn.click();
        assert.equal(acted, 1);
        assert.equal(document.getElementById('undo-toasts'), null);
        dismiss(); // idempotent after click-dismiss
    });

    it('dismiss removes an untouched toast', () => {
        const dismiss = showUndoToast({
            message: 'Hi', actionLabel: 'OK', durationMs: 60000, onAction: () => {},
        });
        assert.ok(document.querySelector('#undo-toasts .undo-toast'));
        dismiss();
        assert.equal(document.getElementById('undo-toasts'), null);
    });
});
