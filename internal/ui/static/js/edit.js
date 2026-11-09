// Inline editing: open/cancel/save, clipboard copy, JSON highlighting.
// Editor caret helpers preserve the cursor across highlight re-renders.

import { store } from './store.js';
import { copyText, showToast, showUndoToast } from './dom.js';
import { deleteKey, loadAllData, putKey, putRawKey } from './api.js';
import { createArmedAction } from './confirm.js';
import { createPendingToggles, UNDO_DELAY_MS } from './pending.js';
import { prettySafe } from './format.js';
import { setToggle, toggleValueFor } from './toggle.js';

// One shared controller: per-key timers, last click wins. commit refreshes
// from the server (success is silent — the undo toast already communicated);
// revert flips the switch back; fail reverts and reports.
const undoToasts = new Map();
let unloadFlush = false;

const pendingToggles = createPendingToggles({
    commit: async (key, value) => {
        // Serialize: pending keys commit before this one reloads, so a
        // live Undo toast never watches a stale switch.
        await flushPendingToggles();
        dismissUndoToast(key);
        setRowBusy(key, true);
        await putKey(key, value, { keepalive: unloadFlush });
        await loadAllData();
    },
    revert: (key, original) => setRowToggle(key, original),
    fail: (key, original, err) => {
        console.error('Error saving toggle:', err);
        showToast(`Failed to save "${key}"`, 'error');
    },
});

function dismissUndoToast(key) {
    const dismiss = undoToasts.get(key);
    if (dismiss) {
        dismiss();
        undoToasts.delete(key);
    }
}

function setRowToggle(key, on) {
    const btn = document.querySelector(`.toggle[data-key="${CSS.escape(key)}"]`);
    if (!btn) return;
    btn.disabled = false;
    setToggle(btn, on);
}

function setRowBusy(key, busy) {
    const btn = document.querySelector(`.toggle[data-key="${CSS.escape(key)}"]`);
    if (btn) btn.disabled = busy;
}

function serverBool(key) {
    const regInfo = store.registries[key];
    const inCode = key in store.registries;
    const inDB = store.dbKeys && store.dbKeys[key];
    if (inDB && inCode) return toggleValueFor('green', regInfo, store.configs[key]);
    if (inDB && !inCode) return toggleValueFor('gray', null, store.configs[key]);
    return null;
}

export function flipBool(key) {
    const btn = document.querySelector(`.toggle[data-key="${CSS.escape(key)}"]`);
    if (!btn) return;
    const original = serverBool(key);
    if (original === null) return;
    const staged = !btn.classList.contains('is-on');
    setToggle(btn, staged);

    dismissUndoToast(key);
    const status = pendingToggles.stage(key, original, staged);
    if (status === 'noop') return;
    undoToasts.set(key, showUndoToast({
        message: 'Settings changed',
        actionLabel: 'Undo',
        durationMs: UNDO_DELAY_MS,
        onAction: () => pendingToggles.undo(key),
    }));
}

// Flush pending toggles immediately. On pagehide the app is going away,
// so commits go out with keepalive instead of waiting out the timer;
// user actions reuse it to serialize before their own reload (keepalive
// there is a no-op — same bytes on the wire).
export function flushPendingToggles() {
    unloadFlush = true;
    const done = pendingToggles.flushAll();
    done.finally(() => { unloadFlush = false; });
    return done;
}

export function startEdit(key) {
    if (store.editingKey) {
        const same = store.editingKey === key;
        cancelEdit();
        if (same) return;
    }

    store.editingKey = key;
    const row = document.querySelector(`.config-row[data-key="${CSS.escape(key)}"]`);
    const panel = document.getElementById(`edit-panel-${key}`);

    // Visibility lives in CSS (.editing + panel grid unfold). Only clear
    // a stale inline hide left by search filtering, flush, then add the
    // class: a transition out of display:none has nothing to start from,
    // so the unfold would snap full-height in one frame.
    if (panel) panel.style.display = '';
    if (panel) void panel.offsetHeight;
    if (row) row.classList.add('editing');

    const input = document.getElementById(`input-${key}`);
    if (input) {
        const form = input.closest('.edit-form');
        if (form && !form.dataset.initial) {
            form.dataset.initial = getEditorRawText(input);
        }
        updateSaveDisabled(key);
        wireEditInput(input, key);
    }

    setTimeout(() => {
        // The row may have closed or switched while waiting: focusing a
        // dead editor steals focus and wires listeners onto it.
        if (store.editingKey !== key) return;
        const input = document.getElementById(`input-${key}`);
        if (!input || input.tagName !== 'PRE') return;
        // preventScroll: the panel just opened around the input — a
        // default focus() scrolls the nearest scrollable ancestor
        // (.tree-kids-inner) and the row visibly jumps up mid-animation.
        input.focus({ preventScroll: true });
        if (window.hljs) {
            // Caret to the end; the timeout only focuses and paints once.
            const range = document.createRange();
            range.selectNodeContents(input);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            highlightJsonEditor(key);
        }
    }, 50);
}

// Wired once per element: open runs on every startEdit but the node
// survives cancel/reopen, so re-attaching would stack duplicate handlers
// (double Save, double highlight). Fresh nodes from re-renders arrive
// unwired (also called by resumeEditSession).
export function wireEditInput(input, key) {
    if (!input || input.dataset.editWired) return;
    input.dataset.editWired = '1';
    input.addEventListener('input', () => {
        updateSaveDisabled(key);
        if (window.hljs && input.tagName === 'PRE') {
            if (!reformatEditorElement(input)) highlightJsonEditor(key);
        }
    });
    // Raw newlines are invalid JSON, so plain Enter always means
    // submit (Shift+Enter keeps the newline), like the create card.
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !e.shiftKey && getEditorRawText(input).trim() === '' && input.dataset.placeholder) {
            e.preventDefault();
            input.textContent = input.dataset.placeholder;
            if (window.hljs && input.tagName === 'PRE') {
                highlightJsonEditor(key);
            }
            const range = document.createRange();
            range.selectNodeContents(input);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            updateSaveDisabled(key);
            return;
        }
        if (e.key !== 'Enter' || e.shiftKey) return;
        e.preventDefault();
        const saveBtn = input.closest('.edit-form')?.querySelector('button[type="submit"]');
        if (saveBtn && saveBtn.disabled) {
            showToast('No changes', 'info');
            return;
        }
        saveInlineEdit(key);
    });
    input.addEventListener('blur', () => {
        if (window.hljs && input.tagName === 'PRE') {
            if (prettifyEditorElement(input)) highlightJsonEditor(key);
        }
        updateSaveDisabled(key);
    });
    // Rich-text paste would inject markup into the editor: take
    // text/plain only, as typed characters.
    input.addEventListener('paste', (e) => {
        const text = e.clipboardData?.getData('text/plain');
        if (text === undefined) return;
        e.preventDefault();
        if (typeof document.execCommand === 'function') {
            document.execCommand('insertText', false, text);
        }
    });
}

// Edit-session suspend/resume across re-renders: renderConfigs rebuilds
// every panel node, which would silently drop an open draft (and its
// staged review) while store.editingKey dangles. renderConfigs suspends
// first and resumes after, so a background reload keeps the session.
export function suspendEditSession() {
    if (!store.editingKey) return null;
    const input = document.getElementById(`input-${store.editingKey}`);
    const form = input ? input.closest('.edit-form') : null;
    if (!input || !form) return null;
    const review = form.querySelector('.commit-review');
    return {
        key: store.editingKey,
        draft: getEditorRawText(input),
        initial: form.dataset.initial,
        reviewing: !!review && !review.hasAttribute('hidden'),
    };
}

export function resumeEditSession(snap) {
    if (!snap) return;
    const row = document.querySelector(`.config-row[data-key="${CSS.escape(snap.key)}"]`);
    const input = document.getElementById(`input-${snap.key}`);
    const form = input ? input.closest('.edit-form') : null;
    if (!row || !input || !form) {
        // Key vanished from the payload (deleted): drop the session.
        if (store.editingKey === snap.key) cancelEdit();
        return;
    }
    input.textContent = snap.draft;
    if (snap.initial !== undefined) form.dataset.initial = snap.initial;
    wireEditInput(input, snap.key);
    highlightJsonEditor(snap.key);
    updateSaveDisabled(snap.key);
    row.classList.add('editing');
    store.editingKey = snap.key;
    // Staged values survive in pendingCommit: repaint the review.
    // Focus intentionally untouched — the user may be elsewhere.
    if (snap.reviewing) enterCommitReview(snap.key);
}

// Cancel button: discard the draft and clear errors, like the create
// card's Cancel. Other cancelEdit callers (search, Escape, toggles) keep
// the draft in the DOM for one-click reopen — see onSearchInput.
export function cancelAndReset() {
    const key = store.editingKey;
    if (!key) return;
    const input = document.getElementById(`input-${key}`);
    if (input) {
        input.classList.remove('error');
        const raw = store.dbRawValues ? store.dbRawValues[key] : undefined;
        input.textContent = raw !== undefined ? raw : '';
        updateSaveDisabled(key);
    }
    cancelEdit();
}

export function cancelEdit() {
    if (!store.editingKey) return;

    const key = store.editingKey;
    const row = document.querySelector(`.config-row[data-key="${CSS.escape(key)}"]`);

    if (row) row.classList.remove('editing');
    resetReviewUI(key);
    pendingCommit.delete(key);

    store.editingKey = null;
}

export function getEditorRawText(input) {
    return input.innerText || input.textContent;
}

// Pretty-normalized form, or null when the text is not valid JSON.
function tryPretty(text) {
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
        return null;
    }
}

// Save is disabled only when the value parses AND matches what the
// editor opened with (whitespace-only edits count as no change).
// Invalid JSON keeps Save enabled so the click can toast the error.
export function updateSaveDisabled(key) {
    const input = document.getElementById(`input-${key}`);
    if (!input) return;
    const form = input.closest('.edit-form');
    const saveBtn = form ? form.querySelector('button[type="submit"]') : null;
    if (!saveBtn) return;
    const curPretty = tryPretty(getEditorRawText(input));
    if (curPretty === null) {
        saveBtn.disabled = false;
        return;
    }
    // Code-only rows have no stored value: any valid input is new, even
    // when it matches the prefilled default (false/0/""/[]/{}).
    if (!store.dbKeys || !store.dbKeys[key]) {
        saveBtn.disabled = false;
        return;
    }
    const initRaw = (form && form.dataset.initial !== undefined) ? form.dataset.initial : getEditorRawText(input);
    const initPretty = tryPretty(initRaw);
    if (initPretty === null) {
        saveBtn.disabled = false;
        return;
    }
    saveBtn.disabled = (curPretty === initPretty);
}

// Staged commit-review values: key -> { value, oldPretty, newPretty }.
const pendingCommit = new Map();

// Test-only reset: staged commits and toast dismissals outlive
// installDom/resetStore (module state keyed by nothing resettable).
export function resetEditTransients() {
    pendingCommit.clear();
    undoToasts.clear();
}

function formFor(key) {
    const input = document.getElementById(`input-${key}`);
    return input ? input.closest('.edit-form') : null;
}

function resetReviewUI(key) {
    const form = formFor(key);
    if (!form) return;
    const editRow = form.querySelector('.edit-form-row');
    if (editRow) editRow.style.display = '';
    const editActions = form.querySelector(':scope > .edit-actions');
    if (editActions) editActions.style.display = '';
    const review = form.querySelector('.commit-review');
    if (review) review.hidden = true;
}

function paintDiff(form, oldPretty, newPretty) {
    const rows = diffPrettyLines(oldPretty, newPretty);
    const wasPre = form.querySelector('.diff-was');
    const becamePre = form.querySelector('.diff-became');
    if (!wasPre || !becamePre) return;
    wasPre.textContent = '';
    becamePre.textContent = '';
    for (const r of rows) {
        if (r.op === '+') {
            const div = document.createElement('div');
            div.className = 'diff-line diff-add';
            div.textContent = r.text;
            becamePre.appendChild(div);
        } else if (r.op === '-') {
            const div = document.createElement('div');
            div.className = 'diff-line diff-del';
            div.textContent = r.text;
            wasPre.appendChild(div);
        } else {
            // Unchanged lines need no tone: plain diff-line, no hook class.
            const w = document.createElement('div');
            w.className = 'diff-line';
            w.textContent = r.text;
            wasPre.appendChild(w);
            const b = document.createElement('div');
            b.className = 'diff-line';
            b.textContent = r.text;
            becamePre.appendChild(b);
        }
    }
}

// Save → review (no PUT). Returns true when the review opened.
export function enterCommitReview(key) {
    const input = document.getElementById(`input-${key}`);
    const form = formFor(key);
    if (!input || !form) return false;
    const rawText = getEditorRawText(input);
    let value;
    try {
        value = JSON.parse(rawText);
    } catch (e) {
        input.classList.add('error');
        showToast('Invalid JSON: ' + e.message, 'error');
        return false;
    }
    input.classList.remove('error');
    const newPretty = JSON.stringify(value, null, 2);
    const initRaw = form.dataset.initial !== undefined ? form.dataset.initial : rawText;
    const initPretty = tryPretty(initRaw);
    // Code-only rows have no stored value: any valid input is new, even
    // when it matches the prefilled default (false/0/""/[]/{}).
    const isCodeOnly = !store.dbKeys || !store.dbKeys[key];
    if (!isCodeOnly && initPretty !== null && initPretty === newPretty) return false;
    const oldPretty = initPretty !== null ? initPretty : tryPretty(initRaw) || initRaw;
    pendingCommit.set(key, { rawText, oldPretty, newPretty });
    const editRow = form.querySelector('.edit-form-row');
    if (editRow) editRow.style.display = 'none';
    const editActions = form.querySelector(':scope > .edit-actions');
    if (editActions) editActions.style.display = 'none';
    paintDiff(form, oldPretty, newPretty);
    const review = form.querySelector('.commit-review');
    if (review) review.hidden = false;
    return true;
}

export function backToEdit(key) {
    const form = formFor(key);
    if (!form) return;
    pendingCommit.delete(key);
    const editRow = form.querySelector('.edit-form-row');
    if (editRow) editRow.style.display = '';
    const editActions = form.querySelector(':scope > .edit-actions');
    if (editActions) editActions.style.display = '';
    const review = form.querySelector('.commit-review');
    if (review) review.hidden = true;
    updateSaveDisabled(key);
}

export async function commitStagedEdit(key) {
    const staged = pendingCommit.get(key);
    if (!staged) return;
    const form = formFor(key);
    const commitBtn = form ? form.querySelector('[data-action="commit"]') : null;
    if (commitBtn) {
        commitBtn.disabled = true;
        commitBtn.textContent = 'Saving...';
    }
    try {
        await flushPendingToggles();
        await putRawKey(key, staged.rawText);
        showToast(`Config "${key}" updated successfully`, 'success');
        pendingCommit.delete(key);
        cancelEdit();
        await loadAllData();
    } catch (error) {
        console.error('Error saving config:', error);
        showToast('Failed to save: ' + error.message, 'error');
    } finally {
        if (commitBtn) {
            commitBtn.disabled = false;
            commitBtn.textContent = 'Commit';
        }
    }
}

export async function saveInlineEdit(key) {
    enterCommitReview(key);
}

export function copyKey(key) {
    copyText(key, `Copied key "${key}"`);
}

export function copyValue(key) {
    // Exact DB text when known (parsed memory rounds big integers);
    // for yellow keys fall back to compiled-in defaultRaw.
    const raw = store.dbRawValues ? store.dbRawValues[key] : undefined;
    const defRaw = store.registries[key]?.defaultRaw;
    const text = raw !== undefined
        ? raw
        : (defRaw || JSON.stringify(store.configs[key] !== undefined ? store.configs[key] : null, null, 2));
    copyText(text, `Copied value of "${key}"`);
}

// Delete (gray) / reset-to-default (green/red): two-click arm. First click
// arms the button (auto-disarms on timeout via onExpire); second click fires.
// Rendered rows re-sync from here after every reload: the map outlives the
// DOM, so a rebuilt button must show the live armed state.
export function isDeleteArmed(key) {
    return deleteArm.isArmed(key);
}

function isRegistryKey(key) {
    return !!(store.registries && key in store.registries);
}

function idleDeleteTitle(key) {
    return isRegistryKey(key) ? 'Reset to default' : 'Delete key';
}

function armedDeleteTitle(key) {
    return isRegistryKey(key) ? 'Click again to confirm reset' : 'Click again to confirm delete';
}

const deleteArm = createArmedAction({
    onExpire: (key) => {
        const btn = document.querySelector(`.delete-btn[data-key="${CSS.escape(key)}"]`);
        if (btn) {
            btn.classList.remove('armed');
            btn.setAttribute('title', idleDeleteTitle(key));
        }
    },
});

export async function clickDelete(key) {
    const isReset = isRegistryKey(key);
    if (deleteArm.click(key) === 'armed') {
        const btn = document.querySelector(`.delete-btn[data-key="${CSS.escape(key)}"]`);
        btn?.classList.add('armed');
        btn?.setAttribute('title', armedDeleteTitle(key));
        return;
    }
    try {
        await flushPendingToggles();
        await deleteKey(key);
        if (store.editingKey === key) {
            cancelEdit();
        }
        showToast(isReset ? `Key "${key}" reset to default` : `Key "${key}" deleted`, 'success');
        await loadAllData();
    } catch (error) {
        console.error('Error deleting key:', error);
        const verb = isReset ? 'reset' : 'delete';
        showToast(`Failed to ${verb} "${key}": ` + error.message, 'error');
        const btn = document.querySelector(`.delete-btn[data-key="${CSS.escape(key)}"]`);
        if (btn) {
            btn.classList.remove('armed');
            btn.setAttribute('title', idleDeleteTitle(key));
        }
    }
}

function highlightJsonEditor(key) {
    highlightEditorElement(document.getElementById(`input-${key}`));
}

// Shared JSON highlight for non-row editors (create card): same highlight +
// caret preservation as row editors, but element-based (no key lookup).
export function highlightEditorElement(editor) {
    if (!editor || editor.tagName !== 'PRE') return;

    // Save caret as character offsets: a live Range points into DOM nodes
    // that are destroyed by the innerHTML replacement below, so restoring
    // the Range itself drops the caret at the start.
    const saved = getEditorOffsets(editor);

    // innerText is layout text: while the panel is still unfolding it
    // reads clipped (even empty), and repainting from it would wipe what
    // the user just typed. Fall back to DOM text, which is always whole
    // (newlines approximate until unfolded; the next keystroke heals).
    const text = editor.innerText || editor.textContent;
    try {
        editor.innerHTML = hljs.highlight(text, { language: 'json' }).value;
    } catch (e) {
        // Ignore highlighting errors
    }

    if (saved) setEditorOffsets(editor, saved.start, saved.end);
}

// Reformat valid JSON with 2-space indent (same shape row editors open
// with). On input it runs through reformatEditorElement, which keeps the
// caret mapped; blur/paste callers use it directly. Returns whether it rewrote.
export function prettifyEditorElement(editor) {
    if (!editor || editor.tagName !== 'PRE') return false;
    const pretty = prettySafe(editor.innerText);
    if (pretty === null || editor.innerText.trim() === pretty) return false;
    editor.innerText = pretty;
    return true;
}

// LCS line diff for commit review. Returns [{ op: ' ' | '-' | '+', text }].
export function diffPrettyLines(oldText, newText) {
    const a = String(oldText).split('\n');
    const b = String(newText).split('\n');
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const rows = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            rows.push({ op: ' ', text: a[i] });
            i++;
            j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            rows.push({ op: '-', text: a[i] });
            i++;
        } else {
            rows.push({ op: '+', text: b[j] });
            j++;
        }
    }
    while (i < n) {
        rows.push({ op: '-', text: a[i] });
        i++;
    }
    while (j < m) {
        rows.push({ op: '+', text: b[j] });
        j++;
    }
    return rows;
}

// Maps caret offset across JSON pretty-printing by counting non-whitespace chars (preserving spaces inside string literals).
export function mapThroughFormat(oldText, offset, newText) {
    const prefix = oldText.slice(0, offset).replace(/\s+/g, '');
    let seen = 0, i = 0;
    while (i < newText.length && seen < prefix.length) {
        if (!/\s/.test(newText[i])) seen++;
        i++;
    }
    if (offset > 0 && oldText[offset - 1] === ' ' && caretInString(oldText, offset)) {
        while (newText[i] === ' ') i++;
    }
    return i;
}

// True when offset sits inside a "..." literal (escapes honored).
// Best-effort on mid-typing text; only consulted for real spaces.
function caretInString(text, offset) {
    let inStr = false, esc = false;
    for (let i = 0; i < offset && i < text.length; i++) {
        const c = text[i];
        if (esc) {
            esc = false;
            continue;
        }
        if (c === '\\' && inStr) {
            esc = true;
            continue;
        }
        if (c === '"') inStr = !inStr;
    }
    return inStr;
}

// Live reformat for input handlers: when the text is valid AND its shape
// differs, rewrite pretty + highlight, keeping the caret (mapped through
// the content; mid-text reshapes land approximately, never lost). Typing
// inside strings/numbers keeps the shape, so prettify no-ops and the caret
// is untouched. Returns whether it rewrote (callers then skip their own
// highlight — colors are already fresh).
export function reformatEditorElement(editor) {
    if (!editor || editor.tagName !== 'PRE') return false;
    const oldText = editor.innerText;
    const pretty = prettySafe(oldText);
    if (pretty === null || oldText.trim() === pretty) return false;
    // Never collapse user-inserted newlines (Shift+Enter inside {} or
    // blank lines mid-edit) during live typing; blur cleans them up.
    if (pretty.split('\n').length < oldText.trim().split('\n').length) return false;

    const saved = getEditorOffsets(editor);
    editor.innerText = pretty;
    highlightEditorElement(editor);
    if (saved) {
        const mappedStart = mapThroughFormat(oldText, saved.start, editor.innerText);
        const mappedEnd = mapThroughFormat(oldText, saved.end, editor.innerText);
        setEditorOffsets(editor, mappedStart, mappedEnd);
    }
    return true;
}

function getEditorOffsets(editor) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return null;
    const pre = range.cloneRange();
    pre.selectNodeContents(editor);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    return { start, end: start + range.toString().length };
}

function setEditorOffsets(editor, start, end) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const parts = [];
    let total = 0, node;
    while ((node = walker.nextNode())) {
        parts.push(node);
        total += node.textContent.length;
    }
    start = Math.max(0, Math.min(start, total));
    end = Math.max(0, Math.min(end, total));

    const range = document.createRange();
    let acc = 0, sNode = null, sOff = 0, eNode = null, eOff = 0;
    for (const n of parts) {
        const len = n.textContent.length;
        if (sNode === null && start <= acc + len) { sNode = n; sOff = start - acc; }
        if (eNode === null && end <= acc + len) { eNode = n; eOff = end - acc; }
        if (sNode !== null && eNode !== null) break;
        acc += len;
    }

    const sel = window.getSelection();
    if (sNode === null) {
        range.selectNodeContents(editor);
        range.collapse(false);
    } else {
        if (eNode === null) { eNode = sNode; eOff = sOff; }
        range.setStart(sNode, Math.min(sOff, sNode.textContent.length));
        range.setEnd(eNode, Math.min(eOff, eNode.textContent.length));
    }
    sel.removeAllRanges();
    sel.addRange(range);
}
