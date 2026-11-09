import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom, resetStore, stubFetch, restoreFetch } from './dom-harness.js';
import { store } from './store.js';
import { renderConfigs } from './render.js';
import { loadAllData } from './api.js';
import { startEdit, cancelEdit, cancelAndReset, saveInlineEdit, backToEdit, commitStagedEdit, clickDelete } from './edit.js';

function setupPrimitiveRow() {
    store.configs = { 'app/title': 'hello' };
    store.registries = { 'app/title': { key: 'app/title', registry: 'app', type: 'string' } };
    store.dbKeys = { 'app/title': true };
    store.dbRawValues = { 'app/title': '"hello"' };
    renderConfigs(store.configs);
    startEdit('app/title');
}

const saveBtn = () => document.querySelector('.edit-form[data-key="app/title"] button[type="submit"]');
const input = () => document.getElementById('input-app/title');

// Row editors are contenteditable PREs (all types): drive them through
// textContent like a user typing, never through .value.
function setText(el, text) {
    el.textContent = text;
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
}

let fetchCalls;
beforeEach(() => {
    installDom();
    resetStore();
    fetchCalls = stubFetch();
});

afterEach(() => {
    restoreFetch();
});

describe('row edit Save-disabled', () => {
    it('opens with highlighted value, Save disabled', () => {
        setupPrimitiveRow();
        assert.equal(input().tagName, 'PRE');
        assert.equal(input().textContent, '"hello"');
        assert.equal(saveBtn().disabled, true);
        cancelEdit();
    });

    it('enables Save after a real change, disables again on revert', () => {
        setupPrimitiveRow();
        setText(input(), '"world"');
        assert.equal(saveBtn().disabled, false);
        setText(input(), '"hello"');
        assert.equal(saveBtn().disabled, true);
        cancelEdit();
    });

    it('keeps Save enabled on invalid JSON (toast path)', () => {
        setupPrimitiveRow();
        setText(input(), '{bad');
        assert.equal(saveBtn().disabled, false);
        cancelEdit();
    });

    it('submits on plain Enter, keeps newlines on Shift+Enter', async () => {
        setupPrimitiveRow();
        setText(input(), '"world"');
        const enter = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        input().dispatchEvent(enter);
        assert.equal(enter.defaultPrevented, true);
        await new Promise((r) => setTimeout(r, 50));
        const form = document.querySelector('.edit-form[data-key="app/title"]');
        assert.equal(form.querySelector('.commit-review').hasAttribute('hidden'), false);
        assert.equal(fetchCalls.puts.length, 0);
        const shiftEnter = new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
        input().dispatchEvent(shiftEnter);
        assert.equal(shiftEnter.defaultPrevented, false);
        cancelEdit();
    });
});

describe('row edit Save-disabled for code-only rows', () => {
    function setupYellowBool() {
        store.configs = {};
        store.registries = { 'feature/new/feature/flag': { key: 'feature/new/feature/flag', registry: 'feature', type: 'boolean' } };
        store.dbKeys = {};
        store.dbRawValues = {};
        renderConfigs(store.configs);
        startEdit('feature/new/feature/flag');
    }

    const yellowSaveBtn = () => document.querySelector('.edit-form[data-key="feature/new/feature/flag"] button[type="submit"]');
    const yellowInput = () => document.getElementById('input-feature/new/feature/flag');

    it('opens prefilled with the default as editable text, Save stays enabled', () => {
        setupYellowBool();
        assert.equal(yellowInput().tagName, 'PRE');
        assert.equal(yellowInput().textContent, 'false');
        assert.equal(yellowInput().dataset.placeholder, undefined);
        assert.equal(yellowSaveBtn().disabled, false);
        setText(yellowInput(), 'true');
        assert.equal(yellowSaveBtn().disabled, false);
        cancelEdit();
    });

    it('Save on a typed default still enters review without PUT', async () => {
        setupYellowBool();
        setText(yellowInput(), 'false');
        await saveInlineEdit('feature/new/feature/flag');
        assert.equal(fetchCalls.puts.length, 0);
        const form = document.querySelector('.edit-form[data-key="feature/new/feature/flag"]');
        const review = form.querySelector('.commit-review');
        assert.equal(review.hasAttribute('hidden'), false);
        assert.ok(review.textContent.includes('false'));
        cancelEdit();
    });

    it('yellow objects open prefilled with the default as editable text', () => {
        store.configs = {};
        store.registries = { 'experiment/preview/meta': { key: 'experiment/preview/meta', registry: 'experiment', type: 'object' } };
        store.dbKeys = {};
        store.dbRawValues = {};
        renderConfigs(store.configs);
        startEdit('experiment/preview/meta');
        const pre = document.getElementById('input-experiment/preview/meta');
        assert.equal(pre.textContent, '{}');
        assert.equal(pre.dataset.placeholder, undefined);
        cancelEdit();
    });

    it('yellow floats prefill 0.0 with a dot (JSON has no commas)', () => {
        store.configs = {};
        store.registries = { 'experiment/preview/ratio': { key: 'experiment/preview/ratio', registry: 'experiment', type: 'float' } };
        store.dbKeys = {};
        store.dbRawValues = {};
        renderConfigs(store.configs);
        startEdit('experiment/preview/ratio');
        const input = document.getElementById('input-experiment/preview/ratio');
        assert.equal(input.textContent, '0.0');
        assert.equal(input.dataset.placeholder, undefined);
        cancelEdit();
    });
});

describe('row edit commit-review', () => {
    function editWithChange() {
        setupPrimitiveRow();
        setText(input(), '"world"');
    }

    it('Save enters review without PUT, hides input, shows was/became + Back/Commit', async () => {
        editWithChange();
        await saveInlineEdit('app/title');
        assert.equal(fetchCalls.puts.length, 0);
        const form = document.querySelector('.edit-form[data-key="app/title"]');
        const review = form.querySelector('.commit-review');
        assert.equal(review.hasAttribute('hidden'), false);
        assert.ok(review.textContent.includes('hello'));
        assert.ok(review.textContent.includes('world'));
        assert.ok(form.querySelector('[data-action="back"]'));
        assert.ok(form.querySelector('[data-action="commit"]'));
        cancelEdit();
    });

    it('Back returns to edit without PUT', async () => {
        editWithChange();
        await saveInlineEdit('app/title');
        backToEdit('app/title');
        const form = document.querySelector('.edit-form[data-key="app/title"]');
        assert.equal(form.querySelector('.commit-review').hasAttribute('hidden'), true);
        assert.equal(fetchCalls.puts.length, 0);
        assert.equal(saveBtn().disabled, false);
        cancelEdit();
    });

    it('Commit PUTs staged value and reloads', async () => {
        editWithChange();
        await saveInlineEdit('app/title');
        await commitStagedEdit('app/title');
        assert.equal(fetchCalls.puts.length, 1);
        assert.equal(fetchCalls.puts[0].key, 'app/title');
        assert.equal(fetchCalls.puts[0].value, 'world');
        cancelEdit();
    });

    it('invalid JSON never enters review', async () => {
        setupPrimitiveRow();
        setText(input(), '{bad');
        await saveInlineEdit('app/title');
        const form = document.querySelector('.edit-form[data-key="app/title"]');
        const review = form.querySelector('.commit-review');
        assert.equal(review === null || review.hasAttribute('hidden'), true);
        assert.equal(fetchCalls.puts.length, 0);
        cancelEdit();
    });
});

describe('row edit focus', () => {
    it('focuses without scrolling the page (no open-time jump)', async () => {
        store.configs = { 'app/title': 'hello' };
        store.registries = { 'app/title': { key: 'app/title', registry: 'app', type: 'string' } };
        store.dbKeys = { 'app/title': true };
        store.dbRawValues = { 'app/title': '"hello"' };
        renderConfigs(store.configs);
        const el = document.getElementById('input-app/title');
        let focusArgs = null;
        const origFocus = el.focus.bind(el);
        el.focus = (...args) => {
            focusArgs = args;
            return origFocus(...args);
        };
        startEdit('app/title');
        await new Promise((r) => setTimeout(r, 150));
        assert.deepEqual(focusArgs, [{ preventScroll: true }]);
        cancelEdit();
    });

    it('a cancelled edit never steals focus afterwards', async () => {
        store.configs = { 'app/title': 'hello' };
        store.registries = { 'app/title': { key: 'app/title', registry: 'app', type: 'string' } };
        store.dbKeys = { 'app/title': true };
        store.dbRawValues = { 'app/title': '"hello"' };
        renderConfigs(store.configs);
        startEdit('app/title');
        cancelEdit();
        await new Promise((r) => setTimeout(r, 150));
        assert.notEqual(document.activeElement, document.getElementById('input-app/title'));
        assert.equal(document.activeElement, document.body);
    });

    it('reopening never stacks duplicate listeners', () => {
        store.configs = { 'app/title': 'hello' };
        store.registries = { 'app/title': { key: 'app/title', registry: 'app', type: 'string' } };
        store.dbKeys = { 'app/title': true };
        store.dbRawValues = { 'app/title': '"hello"' };
        renderConfigs(store.configs);
        const el = document.getElementById('input-app/title');
        let inputCount = 0, keydownCount = 0, blurCount = 0;
        const origAdd = el.addEventListener.bind(el);
        el.addEventListener = (type, ...rest) => {
            if (type === 'input') inputCount++;
            if (type === 'keydown') keydownCount++;
            if (type === 'blur') blurCount++;
            return origAdd(type, ...rest);
        };
        startEdit('app/title');
        cancelEdit();
        startEdit('app/title');
        cancelEdit();
        startEdit('app/title');
        assert.equal(inputCount, 1);
        assert.equal(keydownCount, 1);
        assert.ok(blurCount <= 1);
        cancelEdit();
    });

    it('Enter on unchanged value toasts instead of silently dying', async () => {
        setupPrimitiveRow();
        assert.equal(saveBtn().disabled, true);
        input().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(document.getElementById('toast')?.textContent, 'No changes');
        assert.equal(fetchCalls.puts.length, 0);
        assert.ok(document.querySelector('.config-row[data-key="app/title"].editing'));
        cancelEdit();
    });

    it('staged commits reset between sessions', async () => {
        setupPrimitiveRow();
        setText(input(), '"staged"');
        await saveInlineEdit('app/title');
        resetStore();
        await commitStagedEdit('app/title');
        assert.equal(fetchCalls.puts.length, 0);
    });
});

describe('edit session survives reload', () => {
    function seedFetch() {
        fetchCalls.rows = [
            { key: 'app/title', group: 'app', type: 'string', value: 'hello', dbRaw: '"hello"' },
        ];
    }

    it('draft text and Save state survive a background reload', async () => {
        setupPrimitiveRow();
        setText(input(), '"draft"');
        seedFetch();
        await loadAllData();
        assert.equal(store.editingKey, 'app/title');
        assert.ok(document.querySelector('.config-row[data-key="app/title"].editing'));
        assert.equal(document.getElementById('input-app/title').textContent, '"draft"');
        assert.equal(
            document.querySelector('.edit-form[data-key="app/title"] button[type="submit"]').disabled,
            false,
        );
        assert.equal(fetchCalls.puts.length, 0);
    });

    it('staged review reopens after a background reload', async () => {
        setupPrimitiveRow();
        setText(input(), '"world"');
        await saveInlineEdit('app/title');
        seedFetch();
        await loadAllData();
        assert.equal(store.editingKey, 'app/title');
        const form = document.querySelector('.edit-form[data-key="app/title"]');
        assert.equal(form.querySelector('.commit-review').hasAttribute('hidden'), false);
        assert.ok(form.querySelector('.diff-became').textContent.includes('world'));
        assert.equal(fetchCalls.puts.length, 0);
    });
});

describe('delete failure', () => {
    it('failed second click toasts and disarms', async () => {
        store.configs = { 'db/gone': true };
        store.registries = {};
        store.dbKeys = { 'db/gone': true };
        store.dbRawValues = { 'db/gone': 'true' };
        store.viewMode = 'flat';
        renderConfigs(store.configs);

        fetchCalls.failNextDelete('connection lost');
        await clickDelete('db/gone');
        const btn = document.querySelector('.delete-btn[data-key="db/gone"]');
        assert.ok(btn.classList.contains('armed'), 'first click arms');
        await clickDelete('db/gone');
        assert.match(document.getElementById('toast').textContent, /Failed to delete/);
        assert.ok(!btn.classList.contains('armed'), 'failure disarms');
    });
});

describe('big int exactness', () => {
    function setupBigRow() {
        store.configs = { 'app/big': 9223372036854776000 };
        store.registries = {
            'app/big': { key: 'app/big', registry: 'app', type: 'int' },
        };
        store.dbKeys = { 'app/big': true };
        store.dbRawValues = { 'app/big': '9223372036854775807' };
        store.viewMode = 'flat';
        renderConfigs(store.configs);
    }

    it('editor opens with exact digits, not the rounded float', () => {
        setupBigRow();
        startEdit('app/big');
        const text = document.getElementById('input-app/big').textContent;
        assert.ok(text.includes('9223372036854775807'), `rounded editor: ${text}`);
    });

    it('copy takes the exact DB text', async () => {
        setupBigRow();
        const { copyValue } = await import('./edit.js');
        let copied = null;
        const nav = globalThis.navigator;
        Object.defineProperty(globalThis, 'navigator', {
            value: { clipboard: { writeText: async (t) => { copied = t; } } },
            configurable: true,
        });
        try {
            await copyValue('app/big');
        } finally {
            Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
        }
        assert.equal(copied, '9223372036854775807');
    });
});

describe('cancel button', () => {
    it('discards the draft and clears the error', () => {
        setupPrimitiveRow();
        const input = document.getElementById('input-app/title');
        input.textContent = '{bad';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        saveInlineEdit('app/title');
        assert.ok(input.classList.contains('error'), 'invalid JSON arms the error');

        cancelAndReset();
        assert.ok(!input.classList.contains('error'), 'error cleared');
        assert.equal(input.textContent, '"hello"', 'draft reset to the committed value');

        startEdit('app/title');
        assert.ok(!document.getElementById('input-app/title').classList.contains('error'), 'reopen is clean');
    });

    it('search-cancel keeps the draft for one-click reopen', async () => {
        const { onSearchInput } = await import('./main.js');
        setupPrimitiveRow();
        const input = document.getElementById('input-app/title');
        input.textContent = '"draft"';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));

        document.getElementById('searchInput').value = 'zzz';
        onSearchInput();
        document.getElementById('searchInput').value = '';
        onSearchInput();
        assert.equal(document.getElementById('input-app/title').textContent, '"draft"', 'draft survives search-cancel');
    });
});

describe('delete arm survives reload', () => {
    it('re-rendered button shows the live armed state', () => {
        store.configs = { 'db/gone': true };
        store.registries = {};
        store.dbKeys = { 'db/gone': true };
        store.dbRawValues = { 'db/gone': 'true' };
        store.viewMode = 'flat';
        renderConfigs(store.configs);
        return (async () => {
            const edit = await import('./edit.js');
            await edit.clickDelete('db/gone');
            // Simulate a background reload: fresh DOM from the same store.
            renderConfigs(store.configs);
            const btn = document.querySelector('.delete-btn[data-key="db/gone"]');
            assert.ok(btn.classList.contains('armed'), 'reload must repaint armed');
            assert.equal(btn.getAttribute('title'), 'Click again to confirm delete');
        })();
    });
});

describe('editor open shape', () => {
    function setupObjRow(raw) {
        store.configs = { 'app/obj': { n: 1 } };
        store.registries = {
            'app/obj': { key: 'app/obj', registry: 'app', type: 'object' },
        };
        store.dbKeys = { 'app/obj': true };
        store.dbRawValues = { 'app/obj': raw };
        store.viewMode = 'flat';
        renderConfigs(store.configs);
    }

    it('pretty-prints small minified JSON at open', () => {
        setupObjRow('{"a":1}');
        startEdit('app/obj');
        assert.equal(document.getElementById('input-app/obj').textContent, '{\n  "a": 1\n}');
    });

    it('keeps big integers exact at open', () => {
        setupObjRow('{"n":9223372036854775807}');
        startEdit('app/obj');
        const text = document.getElementById('input-app/obj').textContent;
        assert.ok(text.includes('9223372036854775807'), `rounded at open: ${text}`);
    });
});

describe('yellow rows with defaultRaw', () => {
    const KEY = 'app/svc';
    function setupYellowDefault() {
        store.configs = {};
        store.registries = {
            [KEY]: {
                key: KEY,
                registry: 'app',
                type: 'object',
                defaultRaw: '{"host":"localhost","port":8080}',
            },
        };
        store.dbKeys = {};
        store.dbRawValues = {};
        renderConfigs(store.configs);
    }

    it('row renders default pills instead of the Enter-the-value stub', () => {
        setupYellowDefault();
        const row = document.querySelector(`.config-row[data-key="${KEY}"]`);
        assert.ok(row.classList.contains('state-yellow'));
        const cell = row.querySelector('.config-value');
        assert.ok(cell.innerHTML.includes('localhost'), 'default host pill shown');
        assert.ok(cell.innerHTML.includes('8080'), 'default port pill shown');
        assert.ok(!cell.innerHTML.includes('Enter the value'));
    });

    it('editor opens prefilled with the pretty multi-line default', () => {
        setupYellowDefault();
        startEdit(KEY);
        const pre = document.getElementById(`input-${KEY}`);
        assert.equal(pre.textContent, '{\n  "host": "localhost",\n  "port": 8080\n}');
        assert.equal(pre.dataset.placeholder, undefined);
        cancelEdit();
    });

    it('prefilled struct is valid JSON ready to save', async () => {
        setupYellowDefault();
        startEdit(KEY);
        await saveInlineEdit(KEY);
        assert.equal(fetchCalls.puts.length, 0);
        const form = document.querySelector(`.edit-form[data-key="${KEY}"]`);
        assert.equal(form.querySelector('.commit-review').hasAttribute('hidden'), false);
        cancelEdit();
    });

    it('Tab does nothing once the editor has content', () => {
        setupYellowDefault();
        startEdit(KEY);
        const pre = document.getElementById(`input-${KEY}`);
        pre.textContent = '{"a":1}';
        const tab = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        pre.dispatchEvent(tab);
        assert.equal(pre.textContent, '{"a":1}');
        cancelEdit();
    });
});

describe('reset to default for registry keys', () => {
    it('renders reset button on green and red rows, but not on yellow rows', () => {
        store.configs = { 'app/green': 'v', 'app/red': 'bad', 'app/yellow': null };
        store.registries = {
            'app/green': { key: 'app/green', registry: 'app', type: 'string', defaultRaw: '"def"' },
            'app/red': { key: 'app/red', registry: 'app', type: 'int', defaultRaw: '0' },
            'app/yellow': { key: 'app/yellow', registry: 'app', type: 'int', defaultRaw: '10' },
        };
        store.dbKeys = { 'app/green': true, 'app/red': true };
        store.dbRawValues = { 'app/green': '"v"', 'app/red': '"bad"' };
        store.states = { 'app/green': 'green', 'app/red': 'red', 'app/yellow': 'yellow' };
        store.viewMode = 'flat';
        renderConfigs(store.configs);

        const greenBtn = document.querySelector('.delete-btn[data-key="app/green"]');
        const redBtn = document.querySelector('.delete-btn[data-key="app/red"]');
        const yellowBtn = document.querySelector('.delete-btn[data-key="app/yellow"]');

        assert.ok(greenBtn, 'green row must have reset button');
        assert.equal(greenBtn.getAttribute('title'), 'Reset to default');
        assert.ok(redBtn, 'red row must have reset button');
        assert.equal(redBtn.getAttribute('title'), 'Reset to default');
        assert.equal(yellowBtn, null, 'yellow row has no DB override to reset');
    });

    it('two-click reset deletes the DB override, closes open editor, and toasts reset', async () => {
        setupPrimitiveRow();
        const btn = document.querySelector('.delete-btn[data-key="app/title"]');
        assert.ok(btn);
        assert.equal(btn.getAttribute('title'), 'Reset to default');

        await clickDelete('app/title');
        assert.ok(btn.classList.contains('armed'));
        assert.equal(btn.getAttribute('title'), 'Click again to confirm reset');
        assert.equal(fetchCalls.deletes.length, 0);

        await clickDelete('app/title');
        assert.deepEqual(fetchCalls.deletes, ['app/title']);
        assert.equal(store.editingKey, null, 'open editor must close on reset');
        assert.equal(document.getElementById('toast').textContent, 'Key "app/title" reset to default');
    });
});

describe('key description display', () => {
    it('renders description block and rich key tooltip', () => {
        store.configs = { 'app/title': 'hello' };
        store.registries = {
            'app/title': {
                key: 'app/title',
                registry: 'app',
                type: 'string',
                description: 'Application display title',
            },
        };
        store.dbKeys = { 'app/title': true };
        store.dbRawValues = { 'app/title': '"hello"' };
        renderConfigs(store.configs);
        const panel = document.getElementById('edit-panel-app/title');
        const descEl = panel.querySelector('.key-description');
        assert.ok(descEl, 'description block must render in the edit panel');
        assert.equal(descEl.textContent, 'Application display title');
        const keyEl = document.querySelector('.config-row[data-key="app/title"] .config-key');
        assert.equal(keyEl.getAttribute('title'), 'app/title — Application display title');
    });

    it('omits description block and keeps plain tooltip without description', () => {
        setupPrimitiveRow();
        const panel = document.getElementById('edit-panel-app/title');
        assert.equal(panel.querySelector('.key-description'), null);
        const keyEl = document.querySelector('.config-row[data-key="app/title"] .config-key');
        assert.equal(keyEl.getAttribute('title'), 'app/title');
    });
});

describe('live input keeps decimals and Shift+Enter newlines', () => {
    it('typing 1.05 step-by-step does not eat .0 on input', () => {
        window.hljs = { highlight: (t) => ({ value: t }) };
        try {
            setupPrimitiveRow();
            const el = input();
            for (const step of ['1', '1.', '1.0', '1.05']) {
                setText(el, step);
                assert.equal(el.textContent, step);
            }
        } finally {
            delete window.hljs;
        }
    });

    it('Shift+Enter newline inside {} is not collapsed on input', () => {
        window.hljs = { highlight: (t) => ({ value: t }) };
        try {
            setupPrimitiveRow();
            const el = input();
            setText(el, '{\n}');
            assert.equal(el.textContent, '{\n}');
        } finally {
            delete window.hljs;
        }
    });
});
