// Pure value formatting for rows and pills.

import { escapeAttr, escapeHtml } from './dom.js';
import { getJSONType } from './states.js';

export function getDefaultForType(type) {
    switch (type) {
        case 'string': return '';
        case 'duration': return '0s';
        case 'number': return 0;
        case 'boolean': return false;
        case 'array': return [];
        case 'object': return {};
        default: return null;
    }
}

export function formatValue(value) {
    if (value === null) return '<span class="json-null">null</span>';
    if (Array.isArray(value)) return formatArray(value);
    if (typeof value === 'object') return formatObject(value);
    if (typeof value === 'string') {
        if (value.length > 80) {
            return `<span class="json-string">"${escapeHtml(value.substring(0, 80))}<span class="truncated-dots">…</span></span>`;
        }
        return `<span class="json-string">"${escapeHtml(value)}"</span>`;
    }
    if (typeof value === 'number') return `<span class="json-number">${value}</span>`;
    if (typeof value === 'boolean') return `<span class="json-boolean">${value}</span>`;
    return escapeHtml(String(value));
}

export function formatArray(arr) {
    if (arr.length === 0) return '<span class="json-array">[]</span>';

    // Render all items; fitPillsContainer hides the trailing ones that
    // don't fit and adds a "+N more" pill with the real count.
    const pills = arr.map((item) => {
        const type = getJSONType(item);
        const formatted = formatPillValue(item, type);
        // Only long pills may shrink (with ellipsis); short ones stay whole
        const cls = String(JSON.stringify(item)).length > 24 ? 'pill-truncate' : '';
        return `<span class="pill pill-${type}-element ${cls}" title="${escapeAttr(JSON.stringify(item))}">${formatted}</span>`;
    }).join(' ');

    return `<span class="pill-container">${pills}</span>`;
}

export function formatObject(obj) {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '<span class="json-object">{}</span>';

    // Render all entries; fitPillsContainer hides the trailing ones that
    // don't fit and adds a "+N more" pill with the real count.
    const pills = keys.map((key) => {
        const val = obj[key];
        const type = getJSONType(val);
        const keySpan = `<span class="pill-key">${escapeHtml(key)}</span>`;
        const valSpan = `<span class="pill-val pill-${type}-element">${formatPillValue(val, type)}</span>`;
        // Only long pills may shrink (with ellipsis); short ones stay whole
        const cls = (key.length + String(JSON.stringify(val)).length) > 24 ? 'pill-truncate' : '';
        return `<span class="pill pill-kv ${cls}" title="${escapeAttr(key)}: ${escapeAttr(JSON.stringify(val))}">${keySpan}:${valSpan}</span>`;
    }).join(' ');

    return `<span class="pill-container">${pills}</span>`;
}

export function formatPillValue(val, type) {
    if (val === null) return '<span class="json-null">null</span>';
    if (type === 'string') {
        if (val.length > 10) {
            return `<span class="json-string">"${escapeHtml(val.substring(0, 10))}<span class="truncated-dots">…</span></span>`;
        }
        return `<span class="json-string">"${escapeHtml(val)}"</span>`;
    }
    if (type === 'number') return `<span class="json-number">${val}</span>`;
    if (type === 'boolean') return `<span class="json-boolean">${val}</span>`;
    if (type === 'array') return `<span class="json-array">[${val.length}]</span>`;
    if (type === 'object') return `<span class="json-object">{${Object.keys(val).length}}</span>`;
    return escapeHtml(String(val));
}

// Token regex for the shape-preserving pretty-printer below.
const JSON_TOKEN_RE = /"(?:[^"\\]|\\.)*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\]:,]/g;

// Pretty-print that preserves exact number literals (1.0, -0, 0.05 in progress)
// and never corrupts big integers past 2^53.
// Returns null for invalid JSON.
export function prettySafe(text) {
    try {
        JSON.parse(text);
    } catch {
        return null;
    }
    const noStrings = text.replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
    if (/-?\d{16,}/.test(noStrings)) return text;

    const tokens = text.match(JSON_TOKEN_RE);
    if (!tokens) return null;

    let out = '';
    let depth = 0;
    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok === '{' || tok === '[') {
            const close = tok === '{' ? '}' : ']';
            if (tokens[i + 1] === close) {
                out += tok + close;
                i++;
            } else {
                depth++;
                out += tok + '\n' + '  '.repeat(depth);
            }
        } else if (tok === '}' || tok === ']') {
            depth--;
            out += '\n' + '  '.repeat(depth) + tok;
        } else if (tok === ',') {
            out += ',\n' + '  '.repeat(depth);
        } else if (tok === ':') {
            out += ': ';
        } else {
            out += tok;
        }
    }
    return out;
}
