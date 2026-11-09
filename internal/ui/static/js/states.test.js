import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom, resetStore } from './dom-harness.js';
import { store } from './store.js';
import {
    getState, getJSONType, normalizeType, typesMatch,
    parseDBRaw, getDBRawType, groupStateCounts,
} from './states.js';

beforeEach(() => {
    installDom();
    resetStore();
});

function seed() {
    store.registries = {
        'app/n': { key: 'app/n', registry: 'app', type: 'int' },
        'app/s': { key: 'app/s', registry: 'app', type: 'string' },
    };
    store.dbKeys = { 'app/n': true, 'app/s': true, 'db/only': true };
    store.dbRawValues = { 'app/n': '1', 'app/s': '"x"', 'db/only': 'true' };
}

describe('getJSONType', () => {
    it('classifies JSON values', () => {
        assert.equal(getJSONType(null), 'null');
        assert.equal(getJSONType([1]), 'array');
        assert.equal(getJSONType({}), 'object');
        assert.equal(getJSONType('x'), 'string');
        assert.equal(getJSONType(1.5), 'number');
        assert.equal(getJSONType(true), 'boolean');
    });
});

describe('normalizeType/typesMatch', () => {
    it('maps registry types onto JSON types', () => {
        assert.equal(normalizeType('int'), 'number');
        assert.equal(normalizeType('float'), 'number');
        assert.equal(normalizeType('bool'), 'boolean');
        assert.equal(normalizeType('string'), 'string');
    });

    it('matches equal and int/number-compatible pairs', () => {
        assert.ok(typesMatch('number', 'number'));
        assert.ok(typesMatch('number', 'int'));
        assert.ok(typesMatch('int', 'number'));
        assert.ok(!typesMatch('number', 'string'));
        assert.ok(!typesMatch('boolean', 'number'));
    });
});

describe('getState', () => {
    it('derives all four states', () => {
        seed();
        assert.equal(getState('app/n', 1, store.registries['app/n']), 'green');
        assert.equal(getState('db/only', true, undefined), 'gray');
        delete store.dbKeys['app/s'];
        assert.equal(getState('app/s', '', store.registries['app/s']), 'yellow');
        store.dbRawValues['app/n'] = '"oops"';
        assert.equal(getState('app/n', 1, store.registries['app/n']), 'red');
    });
});

describe('parseDBRaw/getDBRawType', () => {
    it('parses JSON, falls back to raw text, reports missing', () => {
        seed();
        assert.deepEqual(parseDBRaw('app/n'), { found: true, value: 1 });
        store.dbRawValues['app/n'] = 'bare words';
        assert.deepEqual(parseDBRaw('app/n'), { found: true, value: 'bare words' });
        assert.deepEqual(parseDBRaw('nope'), { found: false, value: undefined });
    });

    it('prefers raw type, falls back to memory type', () => {
        seed();
        assert.equal(getDBRawType('app/n', 'zzz'), 'number');
        assert.equal(getDBRawType('missing', 'zzz'), 'string');
    });
});

describe('groupStateCounts', () => {
    it('counts red and yellow only', () => {
        seed();
        store.dbRawValues['app/n'] = '"oops"';
        delete store.dbKeys['app/s'];
        const counts = groupStateCounts(['app/n', 'app/s'], { 'app/n': 1 });
        assert.deepEqual(counts, { red: 1, yellow: 1 });
    });
});

describe('server state wins', () => {
    it('float-in-int is red even though JS sees number/number', () => {
        seed();
        store.states = { 'app/n': 'red' };
        assert.equal(getState('app/n', 1.5, store.registries['app/n']), 'red');
    });

    it('string-typed time value is green despite object code type', () => {
        seed();
        store.states = { 'app/s': 'green' };
        assert.equal(getState('app/s', '2026-09-11T12:00:00Z', { type: 'object' }), 'green');
    });

    it('falls back to local computation without payload states', () => {
        seed();
        assert.equal(getState('app/n', 1, store.registries['app/n']), 'green');
    });
});
