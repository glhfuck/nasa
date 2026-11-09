import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom, resetStore, stubFetch, restoreFetch } from './dom-harness.js';
import { store } from './store.js';
import { loadAllData } from './api.js';

let fetchCalls;
beforeEach(() => {
    installDom();
    resetStore();
    fetchCalls = stubFetch();
});

afterEach(() => {
    restoreFetch();
});

describe('loadAllData rebuild', () => {
    it('rebuilds maps from entries and renders rows', async () => {
        fetchCalls.rows = [
            { key: 'app/one', group: 'app', type: 'string', value: 'one', dbRaw: '"one"', state: 'green' },
            { key: 'db/only', group: 'DB only', type: 'bool', value: true, dbRaw: 'true', state: 'gray' },
        ];
        await loadAllData();

        assert.deepEqual(store.configs, { 'app/one': 'one', 'db/only': true });
        assert.deepEqual(Object.keys(store.registries), ['app/one']);
        assert.deepEqual(store.dbKeys, { 'app/one': true, 'db/only': true });
        assert.deepEqual(store.states, { 'app/one': 'green', 'db/only': 'gray' });
        assert.deepEqual(store.dbRawValues, { 'app/one': '"one"', 'db/only': 'true' });
        assert.ok(document.querySelector('.config-row[data-key="app/one"]'), 'row rendered');
        assert.ok(document.querySelector('.config-row[data-key="db/only"]'), 'gray row rendered');
    });

    it('skips entries with empty dbRaw in key maps', async () => {
        fetchCalls.rows = [
            { key: 'app/code', group: 'app', type: 'int', value: null, dbRaw: '' },
        ];
        await loadAllData();

        assert.ok(!('app/code' in store.dbKeys), 'yellow must not count as in-DB');
        assert.ok(!('app/code' in store.dbRawValues), 'no raw text stored');
        assert.ok('app/code' in store.registries, 'registry entry kept');
    });

    it('toasts on load failure', async () => {
        globalThis.fetch = async () => { throw new Error('conn refused'); };
        await loadAllData();
        assert.match(document.getElementById('toast').textContent, /Failed to load/);
    });
});
