// Create form: pure input parsing (unit-tested) plus the thin DOM glue.
// The + fab expands in place into a card; a click outside the widget or
// Escape collapses it keeping the draft, Cancel collapses and wipes it.

import { loadAllData, putRawKey } from './api.js';
import { showToast } from './dom.js';
import { flushPendingToggles, highlightEditorElement, reformatEditorElement } from './edit.js';
import { store } from './store.js';

// Keys are slash-joined non-empty segments (no leading/trailing slash,
// no empty segments, no . or ..): the tree splits on / and the router
// normalizes dot segments into confusing redirects.
export function isValidKey(key) {
    if (key === '') return false;
    return key.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

export function parseNewKey(keyText, valueText) {
    const key = (keyText ?? '').trim();
    if (!key) throw new Error('Key required');
    if (!isValidKey(key)) throw new Error('Invalid key: use non-empty segments separated by single /');
    let value;
    try {
        value = JSON.parse(valueText);
    } catch {
        throw new Error('Invalid JSON value');
    }
    return { key, value };
}

export function isValidJson(text) {
    try {
        JSON.parse(text);
        return true;
    } catch {
        return false;
    }
}

// The create form refuses keys the client already knows (DB value or
// registry key, including yellow code-only ones — those get values
// through their own row editor). Best-effort only: the snapshot may be
// stale and the server stays upsert (row saves PUT through the same
// endpoint), so a concurrent create can still overwrite.
export function keyExists(key, { configs = {}, registries = {} } = {}) {
    return key in configs || key in registries;
}

export function clickedOutside(target, widget) {
    return !!widget && !widget.contains(target);
}

// The value field is a contenteditable PRE (same JSON editor as rows):
// text comes from innerText, never .value. It grows natively with content
// (capped by CSS max-height); no JS measuring needed. Fall back to DOM
// text while the card is still unfolding: innerText is layout text and
// reads clipped (even empty) mid-morph, which would flunk validation
// on a fast submit.
function valueTextOf(valueInput) {
    if (!valueInput) return '';
    return valueInput.innerText || valueInput.textContent;
}

// Clear validation errors as the user fixes them; errors are only set on submit.
export function validateCreateForm() {
    const keyInput = document.getElementById('createKey');
    const valueInput = document.getElementById('createValue');
    const submit = document.querySelector('#createForm button[type="submit"]');
    if (!keyInput || !valueInput || !submit) return;
    if (keyInput.value.trim() !== '') keyInput.classList.remove('error');
    if (isValidJson(valueTextOf(valueInput))) valueInput.classList.remove('error');
    submit.disabled = false;
}


function widget() {
    return document.getElementById('createWidget');
}

// Fires .settled shortly after open so glow may spill past the edge.
let settleTimer = null;

export function isCreateOpen() {
    return widget()?.classList.contains('expanded') ?? false;
}

export function toggleCreateForm() {
    const w = widget();
    if (!w) return;
    const open = w.classList.toggle('expanded');
    // The scrim shields the background while the card is open (no hover,
    // no active, no clicks through); hiding lives in collapseCreateForm
    // so every dismiss path (outside, Escape, Cancel, success) covers it.
    document.getElementById('createScrim')?.toggleAttribute('hidden', !open);
    // Glow may spill past the card edge only once opened —
    // mid-fade it would smear content outside the growing card.
    clearTimeout(settleTimer);
    w.classList.remove('settled');
    if (open) {
        // preventScroll: the card just opened around the field — a
        // default focus() may scroll the page even though it is visible.
        document.getElementById('createKey')?.focus({ preventScroll: true });
        const valueInput = document.getElementById('createValue');
        if (valueInput) valueInput.style.height = '';
        validateCreateForm();
        settleTimer = setTimeout(() => w.classList.add('settled'), 260);
    }
}

export function collapseCreateForm() {
    clearTimeout(settleTimer);
    widget()?.classList.remove('expanded', 'settled');
    document.getElementById('createScrim')?.setAttribute('hidden', '');
}

// Cancel is collapse plus a wipe: unlike clicking outside the card
// (which keeps the draft), it clears partially filled fields and errors.
export function cancelCreateForm() {
    const keyInput = document.getElementById('createKey');
    const valueInput = document.getElementById('createValue');
    if (keyInput) {
        keyInput.value = '';
        keyInput.classList.remove('error');
    }
    if (valueInput) {
        valueInput.innerHTML = '';
        valueInput.classList.remove('error');
    }
    collapseCreateForm();
    validateCreateForm();
}

// Swallows exactly the dismissing click: set on outside pointerdown,
// consumed by the next click (capture runs before the app's bubble
// handlers), cleared by pointercancel or a new press. One persistent
// gate — persistent (not per-gesture) so drags off-window can't eat
// a later legitimate click.
let swallowNextClick = false;

// Installed once from init: a pointerdown outside the open widget
// collapses it. The opening click targets the + button inside the
// widget, so it never dismisses itself.
export function initCreateWidget() {
    document.addEventListener('click', (e) => {
        if (!swallowNextClick) return;
        swallowNextClick = false;
        e.stopPropagation();
    }, { capture: true });
    document.addEventListener('pointerdown', (e) => {
        swallowNextClick = false;
        if (isCreateOpen() && clickedOutside(e.target, widget())) {
            collapseCreateForm();
            // The dismissing click must not activate the UI behind the card.
            // Primary button only: other buttons produce no click.
            if (e.button === 0) swallowNextClick = true;
            // The swallowed press must not even flash the press effect
            // behind the card: suppress for the gesture, lift on release.
            document.body.classList.add('swallow-press');
            const clearSwallow = () => {
                document.body.classList.remove('swallow-press');
                document.removeEventListener('pointerup', clearSwallow);
                document.removeEventListener('pointercancel', clearSwallow);
            };
            document.addEventListener('pointerup', clearSwallow);
            document.addEventListener('pointercancel', clearSwallow);
        }
    });
    document.addEventListener('pointercancel', () => {
        swallowNextClick = false;
    });
    const valueInput = document.getElementById('createValue');
    document.getElementById('createKey')?.addEventListener('input', validateCreateForm);
    document.getElementById('cancelCreateBtn')?.addEventListener('click', cancelCreateForm);
    valueInput?.addEventListener('input', () => {
        if (document.activeElement === valueInput && valueTextOf(valueInput).trim() === '') {
            valueInput.innerHTML = '';
        }
        validateCreateForm();
        if (!reformatEditorElement(valueInput)) highlightEditorElement(valueInput);
    });
    // Contenteditable never submits a form on Enter: plain Enter creates,
    // Shift+Enter keeps the newline.
    valueInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitCreateForm();
        }
    });
}

export async function submitCreateForm() {
    const keyInput = document.getElementById('createKey');
    const valueInput = document.getElementById('createValue');
    let parsed;
    try {
        parsed = parseNewKey(keyInput?.value, valueTextOf(valueInput));
    } catch (err) {
        showToast(err.message, 'error');
        // Outline every bad field, not just the first failure: an empty
        // form has two problems, and the toast names the first one.
        keyInput?.classList.toggle('error', !isValidKey((keyInput?.value ?? '').trim()));
        valueInput?.classList.toggle('error', !isValidJson(valueTextOf(valueInput)));
        return;
    }
    if (keyExists(parsed.key, store)) {
        showToast(`Key "${parsed.key}" already exists`, 'error');
        keyInput?.classList.add('error');
        return;
    }
    try {
        await flushPendingToggles();
        await putRawKey(parsed.key, valueTextOf(valueInput));
        collapseCreateForm();
        keyInput.value = '';
        if (valueInput) valueInput.innerHTML = '';
        validateCreateForm();
        showToast(`Key "${parsed.key}" created`, 'success');
        await loadAllData();
    } catch (err) {
        showToast(`Failed to create "${parsed.key}": ${err.message}`, 'error');
    }
}
