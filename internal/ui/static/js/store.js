// Client-side state (single owner; every module imports this one).
// configs/registries mirror the last /ui/api/keys payload; dbKeys/dbRawValues
// feed type display. states holds the SERVER state per key (single source
// of truth — the client never recomputes it). UI state (collapse sets,
// view, editing) lives here too so a data reload never loses it.

// Must match the server's gray group name.
export const DB_ONLY_GROUP = 'DB only';

export const store = {
    configs: {},
    // key -> { key, registry, type }
    registries: {},
    // key -> true for keys present in DB
    dbKeys: {},
    // key -> raw DB value text (JSON as stored)
    dbRawValues: {},
    // key -> state badge from the server (green|yellow|red|gray)
    states: {},
    // Registry names collapsed by the user (groups start expanded).
    collapsedGroups: new Set(),
    // Folder ids (registry + '\n' + path) expanded by the user
    // (folders start collapsed).
    expandedFolders: new Set(),
    // Tree view is the default; initView() syncs the saved choice at startup.
    viewMode: 'tree',
    // Full key currently open in the inline editor, if any.
    editingKey: null,
};

// Search session: snapshot of collapsed folders taken when a query starts
// (restored when it clears) plus folders the user explicitly closed
// mid-search (kept shut while typing). Lives here so toggleFolder can sync
// explicit toggles without importing search.js, which imports render.js.
export const searchSession = {
    // Set<folderId> while a query is active, null otherwise.
    snapshot: null,
    userClosed: new Set(),
    // Same pair for collapsed registry groups (keyed by registry name):
    // search expands groups with matches and restores them on clear.
    groupSnapshot: null,
    groupUserClosed: new Set(),
    // View the folder snapshot was taken in (tree has folders, flat does
    // not): clearing after a view switch restores from store truth instead.
    snapshotView: null,
};

export function isTreeView() {
    return store.viewMode === 'tree';
}
