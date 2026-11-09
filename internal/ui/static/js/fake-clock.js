// Fake clock for timer tests: timers fire only when advance() moves
// past them. Async advance covers sync callbacks too.
export function fakeClock() {
    let now = 0;
    let nextId = 1;
    const timers = new Map();
    return {
        setTimeout(fn, ms) {
            const id = nextId++;
            timers.set(id, { fn, at: now + ms });
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        async advance(ms) {
            const target = now + ms;
            while (true) {
                const due = [...timers.entries()]
                    .filter(([, t]) => t.at <= target)
                    .sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) break;
                timers.delete(due[0]);
                now = due[1].at;
                await due[1].fn();
            }
            now = target;
        },
        pendingCount() {
            return timers.size;
        },
    };
}
