import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './dom-harness.js';
import { fitAllPills } from './fit.js';

beforeEach(() => {
    installDom();
});

function containerWithPills(n) {
    const c = document.createElement('div');
    c.className = 'pill-container';
    for (let i = 0; i < n; i++) {
        const p = document.createElement('span');
        p.className = 'pill';
        p.textContent = `p${i}`;
        c.appendChild(p);
    }
    document.body.appendChild(c);
    return c;
}

// jsdom has no layout (all widths are 0): pin the logic by overriding
// the two measurements fitPillsContainer reads.
function mockWidths(el, scroll, client) {
    Object.defineProperty(el, 'scrollWidth', { value: scroll, configurable: true });
    Object.defineProperty(el, 'clientWidth', { value: client, configurable: true });
}

describe('fitPillsContainer', () => {
    it('leaves fitting rows alone and drops the counter', () => {
        const c = containerWithPills(3);
        fitAllPills();
        const pills = [...c.querySelectorAll(':scope > .pill:not(.pill-more)')];
        assert.ok(pills.every((p) => p.style.display !== 'none'));
        assert.equal(c.querySelector(':scope > .pill-more'), null);
    });

    it('hides trailing pills and counts them', () => {
        const c = containerWithPills(4);
        mockWidths(c, 500, 100);
        fitAllPills();
        const pills = [...c.querySelectorAll(':scope > .pill:not(.pill-more)')];
        assert.equal(pills[0].style.display, '');
        assert.ok(pills.slice(1).every((p) => p.style.display === 'none'));
        assert.equal(c.querySelector(':scope > .pill-more').textContent, '… 3 more');
    });

    it('empty container is a no-op', () => {
        const c = document.createElement('div');
        c.className = 'pill-container';
        document.body.appendChild(c);
        fitAllPills();
        assert.equal(c.children.length, 0);
    });
});

describe('fitTruncatedStrings', () => {
    it('shortens overflowing text, keeps the dots', () => {
        const box = document.createElement('div');
        box.className = 'config-value';
        box.textContent = '0123456789abcdef';
        const dots = document.createElement('span');
        dots.className = 'truncated-dots';
        dots.textContent = '…';
        box.appendChild(dots);
        document.body.appendChild(box);
        mockWidths(box, 500, 100);
        fitAllPills();
        const text = box.firstChild.textContent;
        assert.ok(text.length < 16, `not shortened: ${text}`);
        assert.ok(box.querySelector('.truncated-dots'), 'dots removed');
    });
});

describe('fitTruncatedStrings restore', () => {
    it('restores the full text when space allows again', () => {
        const box = document.createElement('div');
        box.className = 'config-value';
        box.textContent = '0123456789abcdef';
        const dots = document.createElement('span');
        dots.className = 'truncated-dots';
        dots.textContent = '…';
        box.appendChild(dots);
        document.body.appendChild(box);
        const mock = (scroll, client) => {
            Object.defineProperty(box, 'scrollWidth', { value: scroll, configurable: true });
            Object.defineProperty(box, 'clientWidth', { value: client, configurable: true });
        };
        mock(500, 100);
        fitAllPills();
        assert.ok(box.firstChild.textContent.length < 16, 'shrunk under pressure');
        mock(500, 600);
        fitAllPills();
        assert.equal(box.firstChild.textContent, '0123456789abcdef', 'restored when wide');
    });
});
