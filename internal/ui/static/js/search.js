// Live search: collapse state is snapshotted on start, matches expand,
// clear restores. Single truth is the class; batch flips run under .no-anim.

import { markLastLines, folderIdOf, refreshHeaderCounts } from './render.js';
import { store, searchSession } from './store.js';

let prevQuery = '';

// Test-only reset: prevQuery outlives installDom/resetStore (module
// state), so without this an empty filter after a reset misreads as
// "clearing" and restores a stale snapshot.
export function resetSearchState() {
    prevQuery = '';
}

export function filterConfigs() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const list = document.getElementById('configList');
    const rows = document.querySelectorAll('.config-row');
    const groups = document.querySelectorAll('.registry-group');
    const starting = prevQuery.length === 0 && search.length > 0;
    const clearing = prevQuery.length > 0 && search.length === 0;
    if (starting) {
        searchSession.snapshot = new Set(
            [...document.querySelectorAll('.tree-folder.collapsed')].map(folderIdOf),
        );
        searchSession.userClosed.clear();
        searchSession.groupSnapshot = new Set(
            [...document.querySelectorAll('.registry-group.collapsed')]
                .map((g) => g.dataset.registry),
        );
        searchSession.groupUserClosed.clear();
        searchSession.snapshotView = store.viewMode;
    }
    list.classList.toggle('searching', search.length > 0);

    rows.forEach(row => {
        const rawKey = row.dataset.key;
        const key = rawKey.toLowerCase();
        const desc = (store.registries[rawKey]?.description || '').toLowerCase();
        // Toggle rows keep their text in a hidden value node; tolerate
        // markup without a visible value anyway (never crash the filter).
        const valueEl = row.querySelector('.config-value');
        const value = (valueEl ? valueEl.textContent : '').toLowerCase();
        const match = key.includes(search) || value.includes(search) || desc.includes(search);
        row.style.display = match ? 'grid' : 'none';
        const panel = document.getElementById(`edit-panel-${rawKey}`);
        if (panel) panel.style.display = 'none';
    });

    // Tree view: hide folders with no visible rows in their subtree.
    // Deepest first so parents see their children's final visibility.
    const folders = [...document.querySelectorAll('.tree-folder')].reverse();
    folders.forEach(folder => {
        const anyVisible = [...folder.querySelectorAll('.config-row')]
            .some(r => r.style.display !== 'none');
        folder.style.display = anyVisible ? '' : 'none';
    });

    // Folders follow matches through the class itself (no overrides): expand
    // visible ones unless the user closed them; on clear restore the
    // snapshot. Applied under .no-anim so a many-folder flip snaps instead
    // of rippling; single toggles keep their slide.
    list.classList.add('no-anim');
    if (search.length > 0) {
        document.querySelectorAll('.tree-folder').forEach(f => {
            if (f.style.display === 'none') return;
            if (searchSession.userClosed.has(folderIdOf(f))) return;
            f.classList.remove('collapsed');
        });
    }
    if (clearing) {
        if (searchSession.snapshotView !== null && searchSession.snapshotView !== store.viewMode) {
            // Snapshot came from another view (flat has no folders, so it
            // is empty): restore from store truth instead of exposing all.
            document.querySelectorAll('.tree-folder').forEach(f => {
                f.classList.toggle('collapsed', !store.expandedFolders.has(folderIdOf(f)));
            });
        } else {
            const snap = searchSession.snapshot ?? new Set();
            document.querySelectorAll('.tree-folder').forEach(f => {
                f.classList.toggle('collapsed', snap.has(folderIdOf(f)));
            });
        }
        searchSession.snapshot = null;
        searchSession.userClosed.clear();
        searchSession.snapshotView = null;
    }
    // Reflow while pinned so the removals below don't animate.
    void list.offsetHeight;
    list.classList.remove('no-anim');

    groups.forEach(group => {
        const visibleRows = group.querySelectorAll('.config-row[style*="grid"], .config-row:not([style*="none"])');
        group.style.display = visibleRows.length > 0 ? 'block' : 'none';
    });

    // Groups follow matches like folders do: expand visible ones unless
    // the user closed them mid-search; on clear restore the snapshot.
    if (search.length > 0) {
        document.querySelectorAll('.registry-group').forEach((g) => {
            if (g.style.display === 'none') return;
            if (searchSession.groupUserClosed.has(g.dataset.registry)) return;
            g.classList.remove('collapsed');
        });
    }
    if (clearing) {
        const gsnap = searchSession.groupSnapshot ?? new Set();
        document.querySelectorAll('.registry-group').forEach((g) => {
            g.classList.toggle('collapsed', gsnap.has(g.dataset.registry));
        });
        searchSession.groupSnapshot = null;
        searchSession.groupUserClosed.clear();
    }

    // Counters/badges recompute from what the filter left visible.
    refreshHeaderCounts();

    markLastLines();
    prevQuery = search;
}
