// Undoable toggle controller: optimistic flip, delayed commit, cancel.
// UI-agnostic: the app wires DOM updates through revert/fail and shows the
// undo toast on 'pending'. Timer and commit are injected so node tests use
// fake clocks and stub APIs while production passes the real ones.

export const UNDO_DELAY_MS = 5000;

export function createPendingToggles({
    delayMs = UNDO_DELAY_MS,
    // Arrow wrappers avoid "Illegal invocation" on detached window timers.
    clock = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) },
    commit,
    revert,
    fail,
} = {}) {
    // key -> { id, original, staged }
    const timers = new Map();

    function stage(key, original, staged) {
        const prev = timers.get(key);
        if (prev) {
            clock.clearTimeout(prev.id);
            timers.delete(key);
        }
        if (staged === original) {
            // Flipped back to what the server already holds: nothing to do.
            revert(key, original);
            return 'noop';
        }
        const id = clock.setTimeout(() => {
            void fire(key);
        }, delayMs);
        timers.set(key, { id, original, staged });
        return 'pending';
    }

    function undo(key) {
        const entry = timers.get(key);
        if (!entry) return false;
        clock.clearTimeout(entry.id);
        timers.delete(key);
        revert(key, entry.original);
        return true;
    }

    async function fire(key) {
        const entry = timers.get(key);
        if (!entry) return false;
        timers.delete(key);
        try {
            await commit(key, entry.staged);
        } catch (err) {
            revert(key, entry.original);
            fail(key, entry.original, err);
        }
        return true;
    }

    async function flushAll() {
        // Snapshot first: fire() mutates the map while iterating it.
        const keys = [...timers.keys()];
        for (const key of keys) {
            const entry = timers.get(key);
            if (entry) clock.clearTimeout(entry.id);
        }
        for (const key of keys) {
            await fire(key);
        }
    }

    return { stage, undo, fire, flushAll };
}
