// Bool toggle switch: markup, state helpers, optimistic flip.
// Only green registry bools and gray DB bools get a switch (yellow
// code-only keys hold no value, red mismatches need the full editor).

import { escapeAttr } from './dom.js';

export function toggleValueFor(state, regInfo, dbValue) {
    if (state === 'green' && regInfo && regInfo.type === 'bool' && typeof dbValue === 'boolean') {
        return dbValue;
    }
    if (state === 'gray' && typeof dbValue === 'boolean') {
        return dbValue;
    }
    return null;
}

export function toggleHtml(key, on) {
    return `<button class="toggle${on ? ' is-on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}" data-action="toggle-bool" data-key="${escapeAttr(key)}" title="Toggle value" aria-label="Toggle ${escapeAttr(key)}"></button>`;
}

// setToggle flips the rendered switch in place.
export function setToggle(el, on) {
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-checked', on ? 'true' : 'false');
}
