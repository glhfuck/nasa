import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseNewKey, isValidJson, isValidKey, keyExists, clickedOutside } from './create.js';

describe('parseNewKey', () => {
    it('trims the key and parses the JSON value', () => {
        assert.deepEqual(parseNewKey('  app/new/flag  ', 'true'), { key: 'app/new/flag', value: true });
    });

    it('rejects an empty key', () => {
        assert.throws(() => parseNewKey('   ', '1'), /Key required/);
    });

    it('rejects invalid JSON', () => {
        assert.throws(() => parseNewKey('app/x', '{bad'), /Invalid JSON/);
    });

    it('rejects an empty value', () => {
        assert.throws(() => parseNewKey('app/x', ''), /Invalid JSON/);
    });

    it('passes JSON documents through untouched', () => {
        assert.deepEqual(
            parseNewKey('app/obj', '{"a":[1,2]}'),
            { key: 'app/obj', value: { a: [1, 2] } },
        );
    });
});

describe('isValidJson', () => {
    it('accepts JSON primitives and documents', () => {
                assert.equal(isValidJson('42'), true);
        assert.equal(isValidJson('"text"'), true);
        assert.equal(isValidJson('{"a":[1,2]}'), true);
    });

    it('rejects empty and broken input', () => {
                assert.equal(isValidJson(''), false);
        assert.equal(isValidJson('   '), false);
        assert.equal(isValidJson('{bad'), false);
        assert.equal(isValidJson('text'), false);
    });
});

describe('keyExists', () => {
    it('finds keys in values and in registries', () => {
                const known = { configs: { 'app/x': 1 }, registries: { 'app/y': {} } };
        assert.equal(keyExists('app/x', known), true);
        assert.equal(keyExists('app/y', known), true);
        assert.equal(keyExists('app/z', known), false);
    });

    it('tolerates missing maps', () => {
                assert.equal(keyExists('app/x'), false);
    });
});

describe('clickedOutside', () => {
    it('is false for clicks inside the widget', () => {
                const widget = { contains: (t) => t === 'inside' };
        assert.equal(clickedOutside('inside', widget), false);
    });

    it('is true for clicks outside the widget', () => {
                const widget = { contains: (t) => t === 'inside' };
        assert.equal(clickedOutside('elsewhere', widget), true);
    });

    it('is false without a widget', () => {
                assert.equal(clickedOutside('elsewhere', null), false);
    });
});

describe('isValidKey', () => {
    it('accepts slash-joined non-empty segments', () => {
        assert.equal(isValidKey('app/flag'), true);
        assert.equal(isValidKey('a/b/c'), true);
        assert.equal(isValidKey('x'), true);
    });

    it('rejects empty segments, dots and edges', () => {
        for (const bad of ['', 'app//flag', '/app/flag', 'app/flag/', 'app/./flag', 'app/../flag', '.', '..']) {
            assert.equal(isValidKey(bad), false, bad || '(empty)');
        }
    });
});

describe('parseNewKey key shape', () => {
    it('rejects bad key shapes with an actionable error', () => {
        assert.throws(() => parseNewKey('app//flag', '1'), /Invalid key/);
        assert.throws(() => parseNewKey('/app', '1'), /Invalid key/);
    });
});
