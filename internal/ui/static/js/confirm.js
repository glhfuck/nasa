// Two-click confirm state machine: first click arms, second click fires,
// timeout disarms. UI-agnostic (no DOM): the app flips button labels
// through the 'armed'/'fired' return values. Clock is injected so node
// tests use a fake while production passes the real one.

export const ARM_MS = 5000;

export function createArmedAction({
    armMs = ARM_MS,
    // Arrow wrappers avoid "Illegal invocation" on detached window timers.
    clock = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) },
    onExpire = () => {},
} = {}) {
    // key -> timer id
    const armed = new Map();

    function click(key) {
        const id = armed.get(key);
        if (id !== undefined) {
            clock.clearTimeout(id);
            armed.delete(key);
            return 'fired';
        }
        armed.set(key, clock.setTimeout(() => {
            armed.delete(key);
            onExpire(key);
        }, armMs));
        return 'armed';
    }

    function isArmed(key) {
        return armed.has(key);
    }

    return { click, isArmed };
}
