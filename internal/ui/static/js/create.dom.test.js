import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom, resetStore, stubFetch, restoreFetch } from './dom-harness.js';
import { store } from './store.js';
import {
    cancelCreateForm,
    collapseCreateForm,
    initCreateWidget,
    isCreateOpen,
    submitCreateForm,
    toggleCreateForm,
    validateCreateForm,
} from './create.js';

const keyInput = () => document.getElementById('createKey');
const valueInput = () => document.getElementById('createValue');
const widget = () => document.getElementById('createWidget');
const scrim = () => document.getElementById('createScrim');
const toast = () => document.getElementById('toast');
const submitBtn = () => document.querySelector('#createForm button[type="submit"]');

function setValue(text) {
    valueInput().textContent = text;
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

describe('create widget open/close', () => {
    it('opens the card and raises the scrim', () => {
        toggleCreateForm();
        assert.equal(isCreateOpen(), true);
        assert.ok(widget().classList.contains('expanded'));
        assert.equal(scrim().hasAttribute('hidden'), false);
    });

    it('focuses the key field without scrolling the page', () => {
        const el = keyInput();
        let focusArgs = null;
        const origFocus = el.focus.bind(el);
        el.focus = (...args) => {
            focusArgs = args;
            return origFocus(...args);
        };
        toggleCreateForm();
        assert.deepEqual(focusArgs, [{ preventScroll: true }]);
    });

    it('collapse hides the card and the scrim', () => {
        toggleCreateForm();
        collapseCreateForm();
        assert.equal(isCreateOpen(), false);
        assert.equal(scrim().hasAttribute('hidden'), true);
    });

    it('settles after the morph, not during', async () => {
        toggleCreateForm();
        assert.equal(widget().classList.contains('settled'), false);
        await new Promise((r) => setTimeout(r, 350));
        assert.equal(widget().classList.contains('settled'), true);
    });

    it('collapse drops settled instantly', async () => {
        toggleCreateForm();
        await new Promise((r) => setTimeout(r, 350));
        collapseCreateForm();
        assert.equal(widget().classList.contains('expanded'), false);
        assert.equal(widget().classList.contains('settled'), false);
    });
});

describe('outside-press click gate', () => {
    function pressOutside() {
        document.body.dispatchEvent(
            new window.PointerEvent('pointerdown', { bubbles: true, button: 0 }),
        );
    }

    function fireClick(target) {
        let passed = false;
        const probe = () => { passed = true; };
        document.addEventListener('click', probe);
        target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        document.removeEventListener('click', probe);
        return passed;
    }

    it('swallows exactly the dismissing click', () => {
        initCreateWidget();
        toggleCreateForm();
        pressOutside();
        assert.equal(isCreateOpen(), false);
        assert.equal(fireClick(document.body), false);
    });

    it('a press that never clicks does not eat the next click', () => {
        initCreateWidget();
        toggleCreateForm();
        pressOutside();
        document.dispatchEvent(new window.PointerEvent('pointercancel', { bubbles: true }));
        assert.equal(fireClick(document.getElementById('createBtn')), true);
    });
});

describe('create widget cancel', () => {
    it('cancel wipes the draft, clears errors and closes', () => {
        toggleCreateForm();
        keyInput().value = 'tmp/draft';
        setValue('42');
        keyInput().classList.add('error');
        valueInput().classList.add('error');
        cancelCreateForm();
        assert.equal(isCreateOpen(), false);
        assert.equal(keyInput().value, '');
        assert.equal(valueInput().textContent, '');
        assert.equal(keyInput().classList.contains('error'), false);
        assert.equal(valueInput().classList.contains('error'), false);
        assert.equal(scrim().hasAttribute('hidden'), true);
    });
});

describe('validateCreateForm', () => {
    it('never disables submit and never paints while typing', () => {
        setValue('{bad');
        validateCreateForm();
        assert.equal(submitBtn().disabled, false);
        assert.equal(keyInput().classList.contains('error'), false);
        assert.equal(valueInput().classList.contains('error'), false);
    });

    it('clears submit-time errors once the fields read valid', () => {
        keyInput().value = 't/x';
        setValue('42');
        keyInput().classList.add('error');
        valueInput().classList.add('error');
        validateCreateForm();
        assert.equal(keyInput().classList.contains('error'), false);
        assert.equal(valueInput().classList.contains('error'), false);
    });
});

describe('submitCreateForm', () => {
    it('empty submit toasts Key required and marks both fields', async () => {
        await submitCreateForm();
        assert.equal(toast().textContent, 'Key required');
        assert.ok(toast().className.includes('error'));
        assert.equal(keyInput().classList.contains('error'), true);
        assert.equal(valueInput().classList.contains('error'), true);
        assert.equal(fetchCalls.puts.length, 0);
    });

    it('bad JSON toasts and marks only the value field', async () => {
        keyInput().value = 't/x';
        setValue('{bad');
        await submitCreateForm();
        assert.equal(toast().textContent, 'Invalid JSON value');
        assert.equal(valueInput().classList.contains('error'), true);
        assert.equal(keyInput().classList.contains('error'), false);
        assert.equal(fetchCalls.puts.length, 0);
    });

    it('duplicate toasts and marks the key without fetching', async () => {
        store.configs = { 't/dup': 1 };
        keyInput().value = 't/dup';
        setValue('1');
        await submitCreateForm();
        assert.equal(toast().textContent, 'Key "t/dup" already exists');
        assert.equal(keyInput().classList.contains('error'), true);
        assert.equal(fetchCalls.puts.length, 0);
    });

    it('valid submit PUTs, clears the form and toasts success', async () => {
        keyInput().value = 't/new';
        setValue('42');
        await submitCreateForm();
        assert.equal(fetchCalls.puts.length, 1);
        assert.equal(fetchCalls.puts[0].key, 't/new');
        assert.equal(fetchCalls.puts[0].value, 42);
        assert.equal(keyInput().value, '');
        assert.equal(valueInput().textContent, '');
        assert.equal(toast().textContent, 'Key "t/new" created');
        assert.ok(fetchCalls.gets > 0);
    });

    it('server 400 toasts failure and keeps the draft', async () => {
        fetchCalls.failNextPut('nope');
        keyInput().value = 't/new';
        setValue('42');
        await submitCreateForm();
        assert.equal(toast().textContent, 'Failed to create "t/new": nope');
        assert.equal(keyInput().value, 't/new');
        assert.equal(valueInput().textContent, '42');
    });

    it('plain Enter in the value field submits', async () => {
        initCreateWidget();
        toggleCreateForm();
        const event = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
        valueInput().dispatchEvent(event);
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(toast().textContent, 'Key required');
    });
});
