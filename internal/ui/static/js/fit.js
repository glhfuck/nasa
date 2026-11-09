// Post-render layout fitting. No imports; DOM-only.

export function fitAllPills() {
    document.querySelectorAll('.pill-container').forEach(fitPillsContainer);
    fitTruncatedStrings();
}

// Hide trailing pills until the row fits, recounting "+N more".
// Called after every render and on window resize (which restores first).
function fitPillsContainer(container) {
    const pills = Array.from(container.querySelectorAll(':scope > .pill:not(.pill-more)'));
    if (pills.length === 0) return;
    const total = pills.length;
    let more = container.querySelector(':scope > .pill-more');
    if (!more) {
        more = document.createElement('span');
        more.className = 'pill pill-more';
        container.appendChild(more);
    }
    pills.forEach(p => { p.style.display = ''; });
    // Fit with the counter visible (worst-case text) so it never ends up clipped.
    more.style.display = '';
    more.textContent = `… ${total} more`;
    let vis = pills.length;
    while (vis > 1 && container.scrollWidth > container.clientWidth + 1) {
        vis--;
        pills[vis].style.display = 'none';
    }
    const hidden = total - vis;
    if (hidden <= 0) more.remove();
    else more.textContent = `… ${hidden} more`;
}

// Shorten truncated strings until they fit, never touching the "..." dots.
// A hard CSS clip would cut into the dots themselves (showing "..").
// The whole text is remembered on the dots node: narrowing must not
// destroy what widening should restore. Cuts are proportional to the
// measured overflow, so it settles in a pass or two instead of dozens
// of measure-mutate reflows.
function fitTruncatedStrings() {
    document.querySelectorAll('.truncated-dots').forEach(dots => {
        const textNode = dots.previousSibling;
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;
        const box = dots.closest('.config-value, .pill-val');
        if (!box) return;
        if (dots.dataset.fullText === undefined) dots.dataset.fullText = textNode.textContent;
        textNode.textContent = dots.dataset.fullText;
        let guard = 0;
        while (guard++ < 8 && textNode.textContent.length > 1 &&
               box.scrollWidth > box.clientWidth + 1) {
            const over = box.scrollWidth - box.clientWidth;
            const perChar = box.scrollWidth / textNode.textContent.length;
            const cut = Math.max(4, Math.ceil(over / perChar) + 1);
            textNode.textContent = textNode.textContent.slice(0, -cut);
        }
    });
}
