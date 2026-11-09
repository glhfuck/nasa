import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom, resetStore, stubFetch, restoreFetch } from './dom-harness.js';
import { store } from './store.js';
import { renderConfigs } from './render.js';
import { filterConfigs } from './search.js';
import { toggleView } from './prefs.js';
import { startEdit } from './edit.js';
import { onSearchInput } from './main.js';

function setupTwoRows() {
    store.configs = { 'app/one': 'one', 'app/two': 'two' };
    store.registries = {
        'app/one': { key: 'app/one', registry: 'app', type: 'string' },
        'app/two': { key: 'app/two', registry: 'app', type: 'string' },
    };
    store.dbKeys = { 'app/one': true, 'app/two': true };
    store.dbRawValues = { 'app/one': '"one"', 'app/two': '"two"' };
    store.viewMode = 'tree';
    renderConfigs(store.configs);
}

const row = (key) => document.querySelector(`.config-row[data-key="${key}"]`);

beforeEach(() => {
    installDom();
    resetStore();
    stubFetch();
});

afterEach(() => {
    restoreFetch();
});

describe('view toggle keeps the search filter', () => {
    it('filtered-out rows stay hidden across flat/tree switches', () => {
        setupTwoRows();
        document.getElementById('searchInput').value = 'one';
        filterConfigs();
        assert.equal(row('app/two').style.display, 'none');
        toggleView();
        assert.equal(store.viewMode, 'flat');
        assert.equal(
            document.querySelector('.config-row[data-key="app/two"]').style.display,
            'none',
        );
        toggleView();
        assert.equal(store.viewMode, 'tree');
        assert.equal(
            document.querySelector('.config-row[data-key="app/two"]').style.display,
            'none',
        );
    });
});

describe('search cancels the edit session', () => {
    it('filtering out and back reopens with one click, draft intact', () => {
        setupTwoRows();
        startEdit('app/one');
        const input = document.getElementById('input-app/one');
        input.textContent = '"draft"';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        document.getElementById('searchInput').value = 'two';
        onSearchInput();
        assert.equal(store.editingKey, null);
        assert.equal(
            document.querySelector('.config-row[data-key="app/one"]').style.display,
            'none',
        );
        document.getElementById('searchInput').value = '';
        onSearchInput();
        startEdit('app/one');
        assert.equal(store.editingKey, 'app/one');
        assert.equal(document.getElementById('input-app/one').textContent, '"draft"');
        assert.equal(
            document.querySelector('.edit-form[data-key="app/one"] button[type="submit"]').disabled,
            false,
        );
    });
});

describe('test isolation', () => {
    it('an empty filter after reset leaves folders alone', () => {
        // Nested keys so a real folder exists (the group prefix itself
        // is stripped from the tree, it is not a folder anymore).
        store.configs = { 'app/limits/a': 'a', 'app/limits/b': 'b' };
        store.registries = {
            'app/limits/a': { key: 'app/limits/a', registry: 'app', type: 'string' },
            'app/limits/b': { key: 'app/limits/b', registry: 'app', type: 'string' },
        };
        store.dbKeys = { 'app/limits/a': true, 'app/limits/b': true };
        store.dbRawValues = { 'app/limits/a': '"a"', 'app/limits/b': '"b"' };
        store.viewMode = 'tree';
        renderConfigs(store.configs);
        document.getElementById('searchInput').value = 'zzz-no-match';
        filterConfigs();
        resetStore();
        store.configs = { 'app/limits/a': 'a', 'app/limits/b': 'b' };
        store.registries = {
            'app/limits/a': { key: 'app/limits/a', registry: 'app', type: 'string' },
            'app/limits/b': { key: 'app/limits/b', registry: 'app', type: 'string' },
        };
        store.dbKeys = { 'app/limits/a': true, 'app/limits/b': true };
        store.dbRawValues = { 'app/limits/a': '"a"', 'app/limits/b': '"b"' };
        store.viewMode = 'tree';
        renderConfigs(store.configs);
        document.getElementById('searchInput').value = '';
        filterConfigs();
        // Without a query-memory reset the empty filter misreads as
        // "clearing" and restores a stale (empty) snapshot, expanding all.
        assert.ok(document.querySelector('.tree-folder').classList.contains('collapsed'));
    });
});
