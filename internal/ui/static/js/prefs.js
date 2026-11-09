// Theme and view-mode preferences. Choices persist in localStorage;
// the early head script in index.html already applied the saved theme
// before first paint, so init only syncs the toggle icons.

import { isTreeView, store } from './store.js';
import { writeStorage, readStorage } from './dom.js';
import { ICON_LIST, ICON_MOON, ICON_SUN, ICON_TREE } from './icons.js';
import { renderConfigs } from './render.js';
import { filterConfigs } from './search.js';
import { cancelEdit } from './edit.js';

export function isDarkTheme() {
    return document.documentElement.dataset.theme === 'dark';
}

export function applyThemeIcon() {
    const btn = document.getElementById('themeBtn');
    if (btn) btn.innerHTML = isDarkTheme() ? ICON_SUN : ICON_MOON;
}

export function initTheme() {
        applyThemeIcon();
}

export function toggleTheme() {
    const root = document.documentElement;
    // Flip colors atomically: with transitions on, every part animates the
    // variable change at its own pace (0.15s here, all 0.2s there) and the
    // page visibly ripples. Kill them for the switch so everything repaints
    // in the same frame, then restore next frame.
    root.classList.add('theme-switch');
    const dark = !isDarkTheme();
    if (dark) root.dataset.theme = 'dark';
    else delete root.dataset.theme;
    // Force reflow while transitions are off so the new colors apply now.
    void root.offsetHeight;
    requestAnimationFrame(() => root.classList.remove('theme-switch'));
    writeStorage('nasa-theme', dark ? 'dark' : 'light');
    applyThemeIcon();
}

export function applyViewIcon() {
    const btn = document.getElementById('viewBtn');
    if (btn) btn.innerHTML = isTreeView() ? ICON_LIST : ICON_TREE;
}

export function initView() {
    // Saved choice is read here at startup (not at store.js load) so module
    // evaluation never touches storage — import order stops mattering.
    const saved = readStorage('nasa-view');
    if (saved === 'flat' || saved === 'tree') store.viewMode = saved;
    applyViewIcon();
}

export function toggleView() {
    store.viewMode = isTreeView() ? 'flat' : 'tree';
    writeStorage('nasa-view', store.viewMode);
    applyViewIcon();
    cancelEdit();
    renderConfigs(store.configs);
    // A rebuild drops the filter's inline hides: re-apply the query,
    // same as loadAllData does after every render.
    filterConfigs();
}
