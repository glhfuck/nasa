// DOM utilities: escaping, toast, clipboard, storage.

export function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// escapeAttr escapes text for double-quoted HTML attribute values.
// div.innerHTML does not escape double quotes, so titles and input values
// containing " would break out of the attribute without this.
export function escapeAttr(text) {
    return escapeHtml(text).replace(/"/g, '&quot;');
}

// Safe localStorage access: private-mode browsers and some sandboxes throw.
export function readStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch (e) { /* storage unavailable */ }
    return null;
}

export function writeStorage(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) { /* storage unavailable */ }
}

export function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'flex' : 'none';
    document.getElementById('configList').style.opacity = show ? '0.5' : '1';
}

let toastTimer = null;

export function showToast(message, type) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `toast ${type} show`;

    // Rearm: without this, an earlier toast's timer hides a newer toast
    // before its own 3 seconds are up.
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

export async function copyText(text, okMessage) {
    try {
        await navigator.clipboard.writeText(text);
        showToast(okMessage, 'success');
    } catch (e) {
        showToast('Failed to copy', 'error');
    }
}

// showUndoToast renders a stacked undo toast with a shrinking time bar.
// Returns a dismiss function; the toast also dismisses itself after
// durationMs (the caller hides it earlier on commit/cancel paths).
export function showUndoToast({ message, actionLabel, durationMs, onAction }) {
    let box = document.getElementById('undo-toasts');
    if (!box) {
        box = document.createElement('div');
        box.id = 'undo-toasts';
        box.className = 'undo-toasts';
        document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'undo-toast show';
    const msg = document.createElement('span');
    msg.textContent = message;
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary btn-sm';
    btn.textContent = actionLabel;
    const bar = document.createElement('span');
    bar.className = 'undo-progress';
    bar.style.animationDuration = `${durationMs}ms`;
    el.append(msg, btn, bar);
    box.appendChild(el);

    const timer = setTimeout(dismiss, durationMs);
    function dismiss() {
        clearTimeout(timer);
        el.remove();
        if (box && box.children.length === 0) box.remove();
    }
    btn.addEventListener('click', () => {
        onAction();
        dismiss();
    });
    return dismiss;
}
