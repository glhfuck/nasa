// Bootstrap: event wiring (all delegated — templates carry data-action,
// never inline handlers), initial load, and the test seam (window.__nasa)
// used by the jsdom harness and browser probes.

import { store, isTreeView } from './store.js';
import { fitAllPills } from './fit.js';
import { filterConfigs } from './search.js';
import { loadAllData } from './api.js';
import {
    cancelEdit, cancelAndReset, clickDelete, copyKey, copyValue, flipBool, flushPendingToggles, saveInlineEdit, startEdit,
    backToEdit, commitStagedEdit,
} from './edit.js';
import { cancelCreateForm, collapseCreateForm, initCreateWidget, submitCreateForm, toggleCreateForm } from './create.js';
import {
    renderConfigs, toggleFolder, toggleRegistry, markLastLines, isShown,
} from './render.js';
import {
    isDarkTheme, initTheme, initView, toggleTheme, toggleView,
} from './prefs.js';
import { getState } from './states.js';

let pillsResizeTimer = null;

// Test seam: the only global this app creates. Browser probes and the
// jsdom harness drive the UI through it instead of bare globals.
if (typeof window !== 'undefined') {
    window.__nasa = {
        store,
        isTreeView,
        isDarkTheme,
        loadAllData,
        renderConfigs,
        toggleView,
        toggleTheme,
        toggleFolder,
        toggleRegistry,
        filterConfigs,
        startEdit,
        cancelEdit,
        backToEdit,
        commitStagedEdit,
        saveInlineEdit,
        flipBool,
        clickDelete,
        toggleCreateForm,
        submitCreateForm,
        cancelCreateForm,
        markLastLines,
        isShown,
        getState,
    };
}

function onListClick(event) {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    switch (actionEl.dataset.action) {
        case 'toggle-group':
            cancelEdit();
            toggleRegistry(actionEl);
            break;
        case 'toggle-folder':
            cancelEdit();
            toggleFolder(actionEl);
            break;
        case 'edit':
            startEdit(actionEl.dataset.key);
            break;
        case 'copy-key':
            copyKey(actionEl.dataset.key);
            break;
        case 'copy-value':
            copyValue(actionEl.dataset.key);
            break;
        case 'toggle-bool':
            flipBool(actionEl.dataset.key);
            break;
        case 'delete':
            clickDelete(actionEl.dataset.key);
            break;
        case 'cancel':
            cancelEdit();
            break;
        case 'back':
            backToEdit(actionEl.dataset.key || actionEl.closest('.edit-form')?.dataset.key);
            break;
        case 'commit':
            commitStagedEdit(actionEl.dataset.key || actionEl.closest('.edit-form')?.dataset.key);
            break;
    }
}

function onListSubmit(event) {
    const form = event.target.closest('.edit-form');
    if (!form) return;
    event.preventDefault();
    saveInlineEdit(form.dataset.key);
}

// Search input: filtering hides rows, so an open editor would dangle
// (hidden panel, live editingKey, two clicks to recover). Cancel first;
// the draft survives in the DOM and reopens with one click.
export function onSearchInput() {
    cancelEdit();
    filterConfigs();
}

export function init() {
    try {
        initTheme();
        initView();
        loadAllData();

        const list = document.getElementById('configList');
        list.addEventListener('click', onListClick);
        list.addEventListener('submit', onListSubmit);
        document.getElementById('searchInput').addEventListener('input', onSearchInput);
        document.getElementById('viewBtn').addEventListener('click', toggleView);
        document.getElementById('themeBtn').addEventListener('click', toggleTheme);
        document.getElementById('createBtn').addEventListener('click', toggleCreateForm);
        document.getElementById('createForm').addEventListener('submit', (e) => {
            e.preventDefault();
            submitCreateForm();
        });
        initCreateWidget();
        window.addEventListener('resize', () => {
            clearTimeout(pillsResizeTimer);
            pillsResizeTimer = setTimeout(fitAllPills, 150);
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && store.editingKey) {
                cancelEdit();
            }
            if (e.key === 'Escape') {
                collapseCreateForm();
            }
        });

        // Unmount equivalent: a pending toggle must not die with the page —
        // flush it immediately instead of waiting out the undo timer.
        window.addEventListener('pagehide', () => {
            flushPendingToggles();
        });

        if (window.hljs) {
            hljs.configure({ languages: ['json'] });
        }

    } catch (e) {
        console.error('CRITICAL INIT ERROR', e);
    }
}
