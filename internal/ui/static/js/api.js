// Backend API: thin fetch wrappers plus the full reload cycle.
// loadAllData rebuilds the store from /ui/api/keys and re-renders
// (UI collapse/expand state lives in the store, so it survives reloads).

import { DB_ONLY_GROUP, store } from './store.js';
import { renderConfigs } from './render.js';
import { filterConfigs } from './search.js';
import { showLoading, showToast } from './dom.js';

export async function fetchKeys() {
    const res = await fetch('/ui/api/keys');
    if (!res.ok) throw new Error('Failed to load keys: ' + res.status);
    return res.json();
}

export async function putKey(key, value, { keepalive = false } = {}) {
    const response = await fetch(`/ui/api/keys/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
        // keepalive lets pagehide-flushed toggles complete after unload.
        keepalive,
    });
    if (!response.ok) {
        throw new Error(await readError(response, 'Failed to save'));
    }
}

// putRawKey sends already-validated JSON text verbatim: parsing and
// re-stringifying would round integers past 2^53 (and reject nothing the
// server wouldn't). Callers validate with JSON.parse first for error UX.
export async function putRawKey(key, rawText, { keepalive = false } = {}) {
    const response = await fetch(`/ui/api/keys/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: rawText,
        keepalive,
    });
    if (!response.ok) {
        throw new Error(await readError(response, 'Failed to save'));
    }
}

export async function deleteKey(key) {
    const response = await fetch(`/ui/api/keys/${encodeURIComponent(key)}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        throw new Error(await readError(response, 'Failed to delete'));
    }
}

// Error bodies are JSON ({error}) from our API, but proxies/crashes may
// answer HTML/text: a blind response.json() would throw SyntaxError and
// mask the real failure, so fall back to the HTTP status.
async function readError(response, fallback) {
    try {
        const err = await response.json();
        return (err && err.error) || fallback;
    } catch {
        return `${fallback} (status ${response.status})`;
    }
}

export async function loadAllData() {
    showLoading(true);

    try {
        const entries = await fetchKeys();

        store.configs = {};
        store.registries = {};
        store.states = {};
        const dbKeys = {};
        const dbValues = {};
        entries.forEach(e => {
            store.configs[e.key] = e.value;
            store.states[e.key] = e.state;
            if (e.group !== DB_ONLY_GROUP) {
                store.registries[e.key] = {
                    key: e.key,
                    registry: e.group,
                    type: e.type,
                    defaultRaw: e.defaultRaw || '',
                    description: e.description || '',
                };
            }
            if (e.dbRaw !== '') {
                dbKeys[e.key] = true;
                dbValues[e.key] = e.dbRaw;
            }
        });

        store.dbKeys = dbKeys;
        // Raw DB values (JSON text as stored) for type-mismatch detection
        store.dbRawValues = dbValues;

        renderConfigs(store.configs);
        // A reload must not drop an active search filter.
        filterConfigs();
    } catch (error) {
        console.error('Error loading data:', error);
        showToast('Failed to load: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}
