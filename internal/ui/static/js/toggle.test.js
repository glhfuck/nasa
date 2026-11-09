import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { setToggle, toggleHtml, toggleValueFor } from './toggle.js';

describe('toggleValueFor', () => {
    it('returns the value for green registry bools', () => {
        assert.equal(toggleValueFor('green', { type: 'bool' }, true), true);
        assert.equal(toggleValueFor('green', { type: 'bool' }, false), false);
    });

    it('returns the value for gray DB bools', () => {
        assert.equal(toggleValueFor('gray', null, true), true);
        assert.equal(toggleValueFor('gray', null, false), false);
    });

    it('returns null for anything else', () => {
        assert.equal(toggleValueFor('yellow', { type: 'bool' }, true), null);
        assert.equal(toggleValueFor('red', { type: 'bool' }, true), null);
        assert.equal(toggleValueFor('green', { type: 'int' }, 1), null);
        assert.equal(toggleValueFor('green', { type: 'bool' }, 1), null);
        assert.equal(toggleValueFor('gray', null, 'yes'), null);
    });
});

describe('toggleHtml', () => {
    it('renders an accessible switch carrying the key', () => {
        const html = toggleHtml('a/b', true);
        assert.match(html, /role="switch"/);
        assert.match(html, /aria-checked="true"/);
        assert.match(html, /data-action="toggle-bool"/);
        assert.match(html, /data-key="a\/b"/);
        assert.match(html, /is-on/);
        assert.doesNotMatch(toggleHtml('a/b', false), /is-on/);
    });
});

describe('setToggle', () => {
    function fakeEl() {
        const classes = new Set();
        const attrs = {};
        return {
            classList: {
                toggle: (name, force) => {
                    if (force) classes.add(name);
                    else classes.delete(name);
                },
                contains: (name) => classes.has(name),
            },
            setAttribute: (k, v) => { attrs[k] = v; },
            getAttribute: (k) => attrs[k],
        };
    }

    it('flips the visual state without touching anything else', () => {
        const el = fakeEl();
        setToggle(el, true);
        assert.ok(el.classList.contains('is-on'));
        assert.equal(el.getAttribute('aria-checked'), 'true');
        setToggle(el, false);
        assert.ok(!el.classList.contains('is-on'));
        assert.equal(el.getAttribute('aria-checked'), 'false');
    });
});
