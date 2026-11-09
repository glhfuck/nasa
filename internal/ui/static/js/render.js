// HTML rendering: groups, tree folders, rows, editor panels.
// Clicks are dispatched by id/class lookup from main.js delegation —
// templates carry data-action/data-key attributes, never inline handlers.

import { store, isTreeView, searchSession } from './store.js';
import {
    getJSONType, getState, groupByRegistry, groupStateCounts, normalizeType, parseDBRaw,
} from './states.js';
import { buildTree, countLeaves, countStates } from './tree.js';
import { escapeAttr, escapeHtml } from './dom.js';
import { fitAllPills } from './fit.js';
import { ICON_CHEVRON, ICON_COPY, ICON_RESET, ICON_TRASH } from './icons.js';
import { formatValue, getDefaultForType, prettySafe } from './format.js';
import { toggleHtml, toggleValueFor } from './toggle.js';
import { isDeleteArmed, suspendEditSession, resumeEditSession } from './edit.js';

const stateLabels = {
    green: 'In DB & Code',
    yellow: 'Code only',
    gray: 'DB only',
    red: 'Type mismatch',
};

// Exact DB text is a JSON number literal (not a string holding digits).
function isJsonNumberText(text) {
    return typeof text === 'string' && /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(text);
}

export function plural(count, one, many) {
    return count === 1 ? one : many;
}

// Header counters/badges follow the filter: recompute every header from
// its currently visible rows (row state classes are the source). With an
// empty query everything is visible, so the same formula restores the
// original totals — no stashing needed. Badges can only shrink (visible is
// a subset), never appear anew.
export function refreshHeaderCounts() {
    document.querySelectorAll('.registry-group, .tree-folder').forEach(scope => {
        const head = scope.querySelector(':scope > .registry-header, :scope > .folder-header');
        if (!head) return;
        const rows = [...scope.querySelectorAll('.config-row')]
            .filter(r => r.style.display !== 'none');
        const nRed = rows.filter(r => r.classList.contains('state-red')).length;
        const nYel = rows.filter(r => r.classList.contains('state-yellow')).length;
        const count = head.querySelector('.registry-count');
        const red = head.querySelector('.state-red');
        const yellow = head.querySelector('.state-yellow');
        if (count) count.textContent = `${rows.length} ${plural(rows.length, 'key', 'keys')}`;
        if (red) {
            red.style.display = nRed ? '' : 'none';
            if (nRed) red.textContent = `${nRed} ${plural(nRed, 'Type mismatch', 'Type mismatches')}`;
        }
        if (yellow) {
            yellow.style.display = nYel ? '' : 'none';
            if (nYel) yellow.textContent = `${nYel} Code only`;
        }
    });
}

export function renderConfigs(data) {
    try {
        const list = document.getElementById('configList');
        const dbKeys = store.dbKeys ? Object.keys(store.dbKeys) : [];

        const allKeys = [...new Set([...Object.keys(data), ...Object.keys(store.registries), ...dbKeys])];

        // An open edit session lives in DOM nodes this rebuild destroys:
        // suspend first, resume after, so background reloads keep drafts.
        const editSnap = suspendEditSession();
        if (allKeys.length === 0) {
            list.innerHTML = '<div style="padding:20px;color:#666;">No configs found</div>';
            if (editSnap) resumeEditSession(editSnap);
            return;
        }

        const registryGroups = groupByRegistry(allKeys, data);

        // Mode hook for CSS: tree-only rules (indent, stripe, guides).
        list.classList.toggle('tree-view', isTreeView());

        list.innerHTML = Object.entries(registryGroups).map(([regName, items]) =>
            renderGroupCard(regName, items, data)).join('');
        markLastLines();
        fitAllPills();
        if (editSnap) resumeEditSession(editSnap);
    } catch (e) {
        console.error('Render configs failed', e);
    }
}

function renderGroupCard(regName, items, data) {
    const counts = groupStateCounts(items, data);
    return `
    <div class="registry-group${store.collapsedGroups.has(regName) ? ' collapsed' : ''}" data-registry="${escapeAttr(regName)}">
        <div class="registry-header" data-action="toggle-group" title="Collapse / expand">
            <span class="registry-chevron">${ICON_CHEVRON}</span>
            <span class="registry-name">${escapeHtml(regName)}</span>
            ${counts.red ? `<span class="state-badge state-red">${counts.red} ${plural(counts.red, 'Type mismatch', 'Type mismatches')}</span>` : ''}
            ${counts.yellow ? `<span class="state-badge state-yellow">${counts.yellow} Code only</span>` : ''}
            <span class="header-spacer"></span>
            <span class="registry-count">${items.length} ${plural(items.length, 'key', 'keys')}</span>
        </div>
        ${isTreeView() ? renderTreeGroup(regName, items, data) : items.map(key => renderRow(key, data[key], store.registries[key])).join('')}
    </div>`;
}


// The last visible box of each group drops its border (no-bottom): the card
// edge draws that line, otherwise a doubled (thick) line appears under
// content while the gutter shows a single one. Nesting, collapse state and
// search filtering decide which box is last, so it is assigned here from
// state (never from layout, which lies mid-transition) rather than in CSS.
export function markLastLines() {
    document.querySelectorAll('.registry-group').forEach(group => {
        group.querySelectorAll('.no-bottom').forEach(el => el.classList.remove('no-bottom'));
        const boxes = [...group.querySelectorAll('.config-row, .folder-header, .registry-header')]
            .filter(isShown);
        if (boxes.length > 0) boxes[boxes.length - 1].classList.add('no-bottom');
    });
}

// Visible through collapsed ancestors: a collapsed box hides everything
// except its own header; display:none hides the whole subtree.
export function isShown(el) {
    if (el.style.display === 'none') return false;
    let node = el;
    let parent = el.parentElement;
    while (parent) {
        if (parent.style && parent.style.display === 'none') return false;
        if (parent.classList && parent.classList.contains('collapsed') &&
            (parent.classList.contains('tree-folder') || parent.classList.contains('registry-group'))) {
            const header = parent.querySelector(':scope > .registry-header, :scope > .folder-header');
            if (!(header && (header === node || header.contains(node)))) return false;
        }
        node = parent;
        parent = parent.parentElement;
    }
    return true;
}

// Tree view: one folder tree per registry group, built from full keys
// minus the shared group prefix (no folder twin of the group header).
export function renderTreeGroup(regName, items, data) {
    const stateOf = (key) => getState(key, data[key], store.registries[key]);
    const root = buildTree(items, regName);
    return renderChildNodes(regName, root, '', data, stateOf, 0);
}

// Renders the children of node at childDepth: pure leaves first, in the
// caller-provided order (state, type, alpha), then subfolders alphabetically.
// A subfolder path that is itself a key (a/b alongside a/b/c) renders its
// own leaf row immediately BEFORE the subfolder — inside the subfolder it
// would read as a/b/b.
function renderChildNodes(regName, node, path, data, stateOf, childDepth) {
    const kids = [...node.children.values()];
    const folders = kids.filter(c => c.children.size > 0)
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const leaves = kids.filter(c => c.children.size === 0);
    return leaves.map(c => renderRow(c.leafKey, data[c.leafKey], store.registries[c.leafKey], displayName(c.leafKey), childDepth)).join('')
        + folders.map(c => {
            const childPath = path ? path + '/' + c.name : c.name;
            const own = c.leafKey !== null
                ? renderRow(c.leafKey, data[c.leafKey], store.registries[c.leafKey], displayName(c.leafKey), childDepth)
                : '';
            return own + renderTreeNode(regName, c, childPath, data, stateOf, childDepth);
        }).join('');
}

// Last key segment for display; the full key stays in data-key,
// copy actions and the tooltip.
export function displayName(key) {
    return key.split('/').pop();
}

function renderTreeNode(regName, node, path, data, stateOf, depth) {
    const folderId = regName + '\n' + path;
    const collapsed = !store.expandedFolders.has(folderId);
    const counts = countStates(node, stateOf);
    return `
        <div class="tree-folder${collapsed ? ' collapsed' : ''}" data-reg="${escapeAttr(regName)}" data-path="${escapeAttr(path)}" style="--depth:${depth}">
            <div class="folder-header" data-action="toggle-folder" title="Collapse / expand">
                <span class="registry-chevron">${ICON_CHEVRON}</span>
                <span class="registry-name">${escapeHtml(node.name)}</span>
                ${counts.red ? `<span class="state-badge state-red">${counts.red} ${plural(counts.red, 'Type mismatch', 'Type mismatches')}</span>` : ''}
                ${counts.yellow ? `<span class="state-badge state-yellow">${counts.yellow} Code only</span>` : ''}
                <span class="header-spacer"></span>
                <span class="registry-count">${countLeaves(node)} ${plural(countLeaves(node), 'key', 'keys')}</span>
            </div>
            <div class="tree-kids"><div class="tree-kids-inner">${renderChildNodes(regName, node, path, data, stateOf, depth + 1)}</div></div>
        </div>
    `;
}

export function folderIdOf(folder) {
    return folder.dataset.reg + '\n' + folder.dataset.path;
}

export function toggleFolder(headerEl) {
    const folder = headerEl.closest('.tree-folder');
    if (!folder) return;
    const folderId = folderIdOf(folder);
    // Proportional timing: a fixed 0.36s makes a 10-leaf folder reveal
    // 10x faster per pixel than a 1-leaf one. Scale the slide by content
    // height so velocity stays roughly constant (clamped both ends).
    // Read .tree-kids-inner (overflow:hidden clips, so its scrollHeight
    // is the full content even while collapsed; the .tree-kids grid box
    // itself reports 0).
    const inner = folder.querySelector(':scope > .tree-kids > .tree-kids-inner');
    if (inner) {
        const ms = Math.min(600, Math.max(100, Math.round((inner.scrollHeight || 0) * 0.9)));
        const kids = folder.querySelector(':scope > .tree-kids');
        if (kids) kids.style.transitionDuration = `${ms}ms`;
    }
    // No scroll compensation: the clicked header never moves due to its own
    // toggle (its content is strictly below it). Measuring across the CSS
    // transition produced garbage shifts that jumped the page and misaligned
    // subsequent clicks; browser scroll anchoring keeps content stable.
    folder.classList.toggle('collapsed');
    const collapsed = folder.classList.contains('collapsed');
    if (collapsed) store.expandedFolders.delete(folderId);
    else store.expandedFolders.add(folderId);
    // A mid-search toggle is explicit user intent: mirror it into the search
    // snapshot (what query-clear restores) and the userClosed set (what
    // keeps it shut while typing). Auto-expansion touches neither.
    if (searchSession.snapshot) {
        if (collapsed) {
            searchSession.snapshot.add(folderId);
            searchSession.userClosed.add(folderId);
        } else {
            searchSession.snapshot.delete(folderId);
            searchSession.userClosed.delete(folderId);
        }
    }
    markLastLines();
}

export function toggleRegistry(headerEl) {
    const group = headerEl.closest('.registry-group');
    if (!group) return;
    const regName = group.dataset.registry;
    // No scroll compensation (same reason as toggleFolder).
    group.classList.toggle('collapsed');
    if (group.classList.contains('collapsed')) store.collapsedGroups.add(regName);
    else store.collapsedGroups.delete(regName);
    // Mid-search toggle sync, mirroring toggleFolder: explicit intent
    // survives typing (userClosed) and clearing (snapshot).
    if (searchSession.groupSnapshot) {
        if (group.classList.contains('collapsed')) {
            searchSession.groupSnapshot.add(regName);
            searchSession.groupUserClosed.add(regName);
        } else {
            searchSession.groupSnapshot.delete(regName);
            searchSession.groupUserClosed.delete(regName);
        }
    }
    markLastLines();
}

export function renderRow(key, dbValue, regInfo, label, depth) {
    const state = getState(key, dbValue, regInfo);
    const inCode = key in store.registries;
    // Tree view shows the short name (last segment); the full key stays
    // in data-key, copy actions and the tooltip. depth indents the row
    // to the nesting level; flat mode omits it.
    const depthStyle = depth !== undefined ? ` style="--depth:${depth}"` : '';

    // What the row shows (and the tooltip): for mismatches the raw DB value,
    // otherwise the entry value. dbValue is always defined — every rendered
    // key comes from the single list payload.
    let displayValue = dbValue, displayType = getJSONType(dbValue);
    if (state === 'red') {
        const raw = parseDBRaw(key);
        if (raw.found) {
            displayValue = raw.value;
            displayType = getJSONType(raw.value);
        }
    }

    let formatted, typeHint;
    const defaultRaw = (state === 'yellow' && regInfo && regInfo.defaultRaw) ? regInfo.defaultRaw : undefined;
    if (defaultRaw !== undefined) {
        try {
            displayValue = JSON.parse(defaultRaw);
        } catch {
            displayValue = defaultRaw;
        }
        displayType = getJSONType(displayValue);
    }

    if (state === 'gray') {
        formatted = formatValue(displayValue);
        typeHint = 'DB only - any type allowed';
    } else if (state === 'yellow') {
        formatted = defaultRaw !== undefined
            ? formatValue(displayValue)
            : '<span class="json-null">Enter the value</span>';
        typeHint = `Required type: ${regInfo ? regInfo.type : 'unknown'}`;
    } else if (state === 'green') {
        formatted = formatValue(displayValue);
        typeHint = `Type: ${regInfo ? regInfo.type : 'unknown'}`;
    } else if (state === 'red') {
        formatted = formatValue(displayValue);
        typeHint = `Type mismatch: DB=${displayType}, Code=${regInfo ? regInfo.type : 'unknown'}`;
    }

    // Exact digits for top-level numbers: the browser re-parses the API
    // payload to float64 (2^63-1 prints rounded), but dbRawValues (or
    // defaultRaw for yellow keys) holds the exact text.
    const rawText = store.dbRawValues ? store.dbRawValues[key] : undefined;
    const exactNumText = rawText !== undefined ? rawText : defaultRaw;
    if (displayType === 'number' && isJsonNumberText(exactNumText)) {
        formatted = `<span class="json-number">${escapeHtml(exactNumText)}</span>`;
    }

    const inputHtml = buildEditor(key, regInfo, state, displayValue, inCode, dbValue, rawText);

    // Bool rows (green registry bools, gray DB bools) render a switch
    // instead of true/false text. The full editor keeps the JSON value.
    // A hidden value node preserves search-by-value and the tooltip source.
    const boolVal = toggleValueFor(state, regInfo, dbValue);
    // Tooltip matches the shown digits: exact raw text for numbers,
    // stringified memory otherwise.
    const titleText = (displayType === 'number' && isJsonNumberText(exactNumText))
        ? exactNumText
        : JSON.stringify(displayValue);
    const valueCell = boolVal === null
        ? `<div class="config-value" title="${escapeAttr(titleText)}">${formatted}</div>`
        : `${toggleHtml(key, boolVal)}<span class="config-value" hidden>${formatted}</span>`;
    // DB-only rows (gray) can be deleted; DB-backed registry rows (green/red)
    // can be reset to their compiled-in default. Both share the two-click arm.
    const canDelete = state === 'gray' || state === 'green' || state === 'red';
    const isReset = state === 'green' || state === 'red';
    const armed = canDelete && isDeleteArmed(key);
    const idleTitle = isReset ? 'Reset to default' : 'Delete key';
    const armedTitle = isReset ? 'Click again to confirm reset' : 'Click again to confirm delete';
    const deleteIcon = isReset ? ICON_RESET : ICON_TRASH;
    const deleteBtn = canDelete
        ? `<button class="copy-btn delete-btn${armed ? ' armed' : ''}" data-action="delete" data-key="${escapeAttr(key)}" title="${armed ? armedTitle : idleTitle}" aria-label="${idleTitle}">${deleteIcon}</button>`
        : '';

    const desc = (regInfo && regInfo.description) ? regInfo.description : '';
    const keyTitle = desc ? `${key} — ${desc}` : key;
    const descHtml = desc ? `<div class="key-description">${escapeHtml(desc)}</div>` : '';

    return `
        <div class="config-row state-${state}" data-key="${escapeAttr(key)}"${depthStyle} data-action="edit">
            <div class="config-key-wrap">
                <div class="config-key" title="${escapeAttr(keyTitle)}">${escapeHtml(label || key)}</div>
                <button class="copy-btn copy-key-btn" data-action="copy-key" data-key="${escapeAttr(key)}" title="Copy key" aria-label="Copy key">${ICON_COPY}</button>
            </div>
            <span class="state-badge state-${state}">${stateLabels[state]}</span>
            <div class="config-value-cell">
                ${valueCell}
                <button class="copy-btn" data-action="copy-value" data-key="${escapeAttr(key)}" title="Copy value" aria-label="Copy">${ICON_COPY}</button>
                ${deleteBtn}
            </div>
        </div>
        <div class="inline-edit-panel" id="edit-panel-${escapeAttr(key)}">
            <form class="edit-form" data-key="${escapeAttr(key)}">
                <div class="edit-form-row">
                    <span class="edit-label">Value</span>
                    <div class="edit-input-wrapper full-width">
                        ${descHtml}
                        ${inputHtml}
                        <span class="type-hint">${escapeHtml(typeHint)}</span>
                    </div>
                </div>
                <div class="edit-actions">
                    <button type="button" class="btn btn-secondary btn-sm" data-action="cancel">Cancel</button>
                    <button type="submit" class="btn btn-primary btn-sm">Save</button>
                </div>
                <div class="commit-review" hidden>
                    <div class="diff-split">
                        <div class="diff-col">
                            <div class="diff-title">Old</div>
                            <pre class="diff-was"></pre>
                        </div>
                        <div class="diff-col">
                            <div class="diff-title">New</div>
                            <pre class="diff-became"></pre>
                        </div>
                    </div>
                    <div class="edit-actions">
                        <button type="button" class="btn btn-secondary btn-sm" data-action="cancel">Cancel</button>
                        <button type="button" class="btn btn-secondary btn-sm" data-action="back">Back</button>
                        <button type="button" class="btn btn-primary btn-sm" data-action="commit">Commit</button>
                    </div>
                </div>
            </form>
        </div>
    `;
}

// buildEditor returns the editor markup for one row. Every type edits in
// a contenteditable PRE so hljs token colors apply uniformly (a plain
// input paints a single color). Primitives render compact single-line;
// code-only rows open prefilled with the compiled-in default as editable
// text (no ghost hint), so structs are one keystroke away from a valid PUT.
function buildEditor(key, regInfo, state, displayValue, inCode, dbValue, rawText) {
    let editorValue, editorType;
    const ghost = '';
    let isEmpty = false;
    // Prefilled default text for code-only rows (no DB text to show).
    let yellowContent;
    if (state === 'yellow') {
        editorType = normalizeType(regInfo.type);
        if (regInfo && regInfo.defaultRaw) {
            yellowContent = prettySafe(regInfo.defaultRaw) ?? regInfo.defaultRaw;
        } else {
            const def = getDefaultForType(regInfo && regInfo.type === 'duration' ? 'duration' : editorType);
            yellowContent = JSON.stringify(def, null, 2);
        }
        // Floats edit with a dot (0.0): JSON numbers never take a
        // comma, and JSON.stringify(0.0) would print a bare "0".
        if (editorType === 'number' && regInfo && regInfo.type === 'float' && yellowContent === '0') {
            yellowContent = '0.0';
        }
    } else {
        editorType = (inCode && regInfo) ? normalizeType(regInfo.type) : getJSONType(dbValue);
        editorValue = displayValue;
    }
    // Exact DB text when known: stringifying the parsed value would
    // round integers past 2^53 before the user even touches the editor.
    // prettySafe keeps the shape when exact, original text otherwise.
    const content = isEmpty
        ? ''
        : (yellowContent !== undefined
            ? yellowContent
            : (rawText !== undefined ? (prettySafe(rawText) ?? rawText) : JSON.stringify(editorValue, null, 2)));
    const ghostAttr = ghost ? ` data-placeholder="${escapeAttr(ghost)}"` : '';
    if (['string', 'number', 'boolean'].includes(editorType)) {
        return `<pre class="json-editor primitive-editor" id="input-${escapeAttr(key)}" contenteditable="true" spellcheck="false" data-type="${editorType}"${ghostAttr}>${escapeHtml(content)}</pre>`;
    }
    return `
        <div class="json-editor-wrapper">
            <pre class="json-editor" id="input-${escapeAttr(key)}" contenteditable="true" spellcheck="false" data-type="${editorType}"${ghostAttr}>${escapeHtml(content)}</pre>
        </div>
    `;
}
