import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom, resetStore, stubFetch, restoreFetch } from './dom-harness.js';
import { store } from './store.js';
import { renderConfigs } from './render.js';

beforeEach(() => {
    installDom();
    resetStore();
    stubFetch();
});

afterEach(() => {
    restoreFetch();
});

// The browser re-parses the API payload to float64, so 2^63-1 would print
// rounded. Rows must render the exact dbRaw text for top-level numbers.
describe('big int display precision', () => {
    it('renders exact digits from dbRaw', () => {
        store.configs = { 'app/big': 9223372036854776000 };
        store.registries = {
            'app/big': { key: 'app/big', registry: 'app', type: 'int' },
        };
        store.dbKeys = { 'app/big': true };
        store.dbRawValues = { 'app/big': '9223372036854775807' };
        store.viewMode = 'flat';
        renderConfigs(store.configs);

        const row = document.querySelector('.config-row[data-key="app/big"]');
        const shown = row.querySelector('.json-number').textContent;
        assert.equal(shown, '9223372036854775807', `rounded display: ${shown}`);
    });
});
