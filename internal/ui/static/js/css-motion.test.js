import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression pin: every animated/transitioned surface must appear in the
// prefers-reduced-motion block (groups.css), or motion-sensitive users
// get animation from newly added CSS. If you animate something new,
// add it there and extend the lists below.
const cssDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'css');
const css = ['groups.css', 'base.css', 'editor.css', 'rows.css', 'tree.css']
    .map((f) => readFileSync(join(cssDir, f), 'utf8'))
    .join('\n');

function reduceBlock() {
    const start = css.indexOf('prefers-reduced-motion');
    assert.notEqual(start, -1, 'no prefers-reduced-motion block found');
    return css.slice(start, start + 2000);
}

describe('prefers-reduced-motion coverage', () => {
    it('kills transitions on every animated surface', () => {
        const block = reduceBlock();
        for (const sel of [
            '.config-row',
            '.tree-kids',
            '.create-widget',
            '.create-tray',
            '.create-fab',
            '.inline-edit-panel',
            '.copy-btn',
            '.toggle',
        ]) {
            assert.ok(block.includes(sel), `missing from reduce block: ${sel}`);
        }
    });

    it('kills keyframe animations', () => {
        const block = reduceBlock();
        for (const sel of ['.toast', '.spinner', '.undo-toast', '.create-widget.expanded']) {
            assert.ok(block.includes(sel), `missing from reduce block: ${sel}`);
        }
    });
});
