import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom, resetStore, stubFetch, restoreFetch } from './dom-harness.js';
import { store } from './store.js';
import { renderConfigs } from './render.js';
import { filterConfigs } from './search.js';
import { toggleView } from './prefs.js';

function setupTwoGroups() {
    store.configs = { 'app/one': 'one', 'other/two': 'two' };
    store.registries = {
        'app/one': { key: 'app/one', registry: 'app', type: 'string' },
        'other/two': { key: 'other/two', registry: 'other', type: 'string' },
    };
    store.dbKeys = { 'app/one': true, 'other/two': true };
    store.dbRawValues = { 'app/one': '"one"', 'other/two': '"two"' };
    store.viewMode = 'tree';
    store.collapsedGroups = new Set(['app']);
    renderConfigs(store.configs);
}

const group = (reg) => document.querySelector(`.registry-group[data-registry="${reg}"]`);

beforeEach(() => {
    installDom();
    resetStore();
    stubFetch();
});

afterEach(() => {
    restoreFetch();
});

describe('search expands collapsed registry groups', () => {
    it('matched group drops collapsed, clear restores it', () => {
        setupTwoGroups();
        assert.ok(group('app').classList.contains('collapsed'), 'pre: app starts collapsed');

        document.getElementById('searchInput').value = 'one';
        filterConfigs();
        assert.ok(!group('app').classList.contains('collapsed'), 'match must expand the group');
        assert.equal(group('app').style.display, 'block');
        assert.equal(group('other').style.display, 'none');

        document.getElementById('searchInput').value = '';
        filterConfigs();
        assert.ok(group('app').classList.contains('collapsed'), 'clear must restore collapse');
    });
});

describe('search across view switch', () => {
    it('clear after flat-to-tree restores store truth, not an empty snapshot', () => {
        store.configs = { 'app/limits/a': 'a', 'other/x': 'x' };
        store.registries = {
            'app/limits/a': { key: 'app/limits/a', registry: 'app', type: 'string' },
            'other/x': { key: 'other/x', registry: 'other', type: 'string' },
        };
        store.dbKeys = { 'app/limits/a': true, 'other/x': true };
        store.dbRawValues = { 'app/limits/a': '"a"', 'other/x': '"x"' };
        store.viewMode = 'flat';
        renderConfigs(store.configs);
        document.getElementById('searchInput').value = 'limits';
        filterConfigs();

        toggleView();
        assert.equal(store.viewMode, 'tree');
        document.getElementById('searchInput').value = '';
        filterConfigs();
        // Folders default to collapsed (never expanded): an empty flat
        // snapshot must not expose them all.
        const folders = [...document.querySelectorAll('.tree-folder')];
        assert.ok(folders.length > 0, 'tree has folders');
        assert.ok(folders.every((f) => f.classList.contains('collapsed')));
    });
});

describe('search matches descriptions', () => {
    it('finds a row by a word present only in its description', () => {
        store.configs = { 'app/rps': 100, 'app/other': 1 };
        store.registries = {
            'app/rps': {
                key: 'app/rps',
                registry: 'app',
                type: 'int',
                description: 'Maximum throughput per node',
            },
            'app/other': { key: 'app/other', registry: 'app', type: 'int' },
        };
        store.dbKeys = { 'app/rps': true, 'app/other': true };
        store.dbRawValues = { 'app/rps': '100', 'app/other': '1' };
        store.viewMode = 'flat';
        renderConfigs(store.configs);
        document.getElementById('searchInput').value = 'throughput';
        filterConfigs();
        const rows = [...document.querySelectorAll('.config-row')];
        const vis = Object.fromEntries(rows.map((r) => [r.dataset.key, r.style.display]));
        assert.equal(vis['app/rps'], 'grid');
        assert.equal(vis['app/other'], 'none');
    });
});
