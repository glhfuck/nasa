// jsdom harness for DOM-level UI tests (node --test, no browser).
// Installs browser globals on import (side effect, runs first — see the
// import-order note in create.dom.test.js), then per-test refresh via
// installDom(). Fixture mirrors the IDs in templates/index.html; if the
// template gains IDs the tested modules need, extend FIXTURE here.

import { JSDOM } from 'jsdom';
import { store, searchSession } from './store.js';
import { resetSearchState } from './search.js';
import { resetEditTransients } from './edit.js';

const FIXTURE = `<!DOCTYPE html><html><head></head><body>
<div class="container"><div class="toolbar">
<button class="btn btn-secondary btn-sm view-fab" id="viewBtn"></button>
<button class="btn btn-secondary btn-sm theme-fab" id="themeBtn"></button>
<div class="create-widget" id="createWidget">
<button class="btn btn-secondary btn-sm create-fab" id="createBtn"></button>
<div class="create-tray"><div class="create-clip">
<form class="create-form" id="createForm">
<input type="text" id="createKey" class="edit-input primitive-editor" placeholder="key/like/this" spellcheck="false" autocomplete="off">
<pre id="createValue" class="json-editor edit-input" contenteditable="true" spellcheck="false" data-placeholder="JSON value"></pre>
<div class="create-form-actions">
<button type="button" class="btn btn-secondary btn-sm" id="cancelCreateBtn">Cancel</button>
<button type="submit" class="btn btn-primary btn-sm">Create</button>
</div></form></div></div></div>
<div class="create-scrim" id="createScrim" hidden></div>
<div class="search-box"><input type="text" id="searchInput"></div>
</div>
<div class="config-list" id="configList"></div>
<div class="loading" id="loading" style="display: none;"></div>
</div></body></html>`;

export function installDom() {
    const dom = new JSDOM(FIXTURE, { url: 'http://localhost/', pretendToBeVisual: true });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.Node = dom.window.Node;
    globalThis.NodeFilter = dom.window.NodeFilter;
    globalThis.Element = dom.window.Element;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.localStorage = dom.window.localStorage;
    // NOTE: no navigator override — Node 26 owns globalThis.navigator
    // (getter-only); prod code reaching bare navigator gets Node's, and
    // window.navigator stays jsdom's for DOM internals.
    if (typeof dom.window.requestAnimationFrame === 'function') {
        globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
    }
    // jsdom omits innerText (a layout-dependent API): mirror textContent
    // on the contenteditable fixture inputs. Prod keeps innerText — plain
    // textContent would join multiline values without newlines in browsers.
    const valueInput = dom.window.document.getElementById('createValue');
    if (valueInput) {
        Object.defineProperty(valueInput, 'innerText', {
            get: () => valueInput.textContent,
            set: (text) => { valueInput.textContent = text; },
            configurable: true,
        });
    }
    // jsdom lacks CSS.escape (browsers all have it): minimal fallback so
    // edit.js selectors work under test.
    if (!globalThis.CSS) {
        globalThis.CSS = { escape: (s) => String(s).replace(/["\\]/g, '\\$&') };
    }
    if (globalThis.window && !globalThis.window.CSS) {
        globalThis.window.CSS = globalThis.CSS;
    }
    return dom;
}

// Fresh browser surface at import (module side effect): store.js reads
// localStorage at load, so globals must exist before it evaluates.
installDom();

export function resetStore() {
    store.configs = {};
    store.registries = {};
    store.dbKeys = {};
    store.dbRawValues = {};
    store.states = {};
    store.collapsedGroups = new Set();
    store.expandedFolders = new Set();
    store.viewMode = 'tree';
    store.editingKey = null;
    searchSession.snapshot = null;
    searchSession.userClosed = new Set();
    searchSession.groupSnapshot = null;
    searchSession.groupUserClosed = new Set();
    searchSession.snapshotView = null;
    resetSearchState();
    resetEditTransients();
}

const realFetch = globalThis.fetch;

// stubFetch routes the app's API calls in-process: PUT/DELETE succeed
// (or fail via failNextPut/failNextDelete), GET /ui/api/keys serves rows.
// Returns call logs for assertions.
export function stubFetch() {
    const calls = { puts: [], deletes: [], gets: 0, rows: [], putError: null, deleteError: null };
    calls.failNextPut = (message) => { calls.putError = message; };
    calls.failNextDelete = (message) => { calls.deleteError = message; };
    globalThis.fetch = async (url, opts = {}) => {
        const method = (opts.method || 'GET').toUpperCase();
        const text = String(url);
        if (method === 'PUT' && text.includes('/ui/api/keys/')) {
            const key = decodeURIComponent(text.split('/ui/api/keys/')[1]);
            const value = JSON.parse(opts.body);
            if (calls.putError) {
                const message = calls.putError;
                calls.putError = null;
                return new Response(JSON.stringify({ error: message }), { status: 400 });
            }
            calls.puts.push({ key, value });
            return new Response(JSON.stringify({ success: true, key }), { status: 200 });
        }
        if (method === 'DELETE' && text.includes('/ui/api/keys/')) {
            const key = decodeURIComponent(text.split('/ui/api/keys/')[1]);
            if (calls.deleteError) {
                const message = calls.deleteError;
                calls.deleteError = null;
                return new Response(JSON.stringify({ error: message }), { status: 400 });
            }
            calls.deletes.push(key);
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        if (text.endsWith('/ui/api/keys')) {
            calls.gets += 1;
            return new Response(JSON.stringify(calls.rows), { status: 200 });
        }
        throw new Error('unexpected fetch in test: ' + method + ' ' + text);
    };
    return calls;
}

export function restoreFetch() {
    globalThis.fetch = realFetch;
}

