import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { prettifyEditorElement, mapThroughFormat, diffPrettyLines } from './edit.js';

describe('prettifyEditorElement', () => {
    // Minimal PRE fake: only the text surface the helper touches.
    function fakePre(text) {
        return {
            tagName: 'PRE',
            _text: text,
            get innerText() { return this._text; },
            set innerText(v) { this._text = v; },
        };
    }

    it('expands compact JSON with 2-space indent', () => {
        const el = fakePre('{"a":1,"b":[1,2]}');
        assert.equal(prettifyEditorElement(el), true);
        assert.equal(el.innerText, '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
    });

    it('leaves invalid JSON untouched', () => {
        const el = fakePre('{bad');
        assert.equal(prettifyEditorElement(el), false);
        assert.equal(el.innerText, '{bad');
    });

    it('leaves already-pretty JSON alone', () => {
        const el = fakePre('{\n  "a": 1\n}');
        assert.equal(prettifyEditorElement(el), false);
        assert.equal(el.innerText, '{\n  "a": 1\n}');
    });

    it('leaves big integers byte-identical', () => {
        const el = fakePre('{"n":9223372036854775807}');
        assert.equal(prettifyEditorElement(el), false);
        assert.equal(el.innerText, '{"n":9223372036854775807}');
    });

    it('preserves trailing decimal zeros and negative zero while typing numbers', () => {
        for (const num of ['1.0', '0.0', '-0', '1.250', '{\n  "a": 1.0\n}']) {
            const el = fakePre(num);
            assert.equal(prettifyEditorElement(el), false, `must not rewrite ${num}`);
            assert.equal(el.innerText, num);
        }
    });

    it('expands compact objects keeping 1.0 intact', () => {
        const el = fakePre('{"a":1.0}');
        assert.equal(prettifyEditorElement(el), true);
        assert.equal(el.innerText, '{\n  "a": 1.0\n}');
    });

    it('ignores non-PRE elements', () => {
        assert.equal(prettifyEditorElement(null), false);
        assert.equal(prettifyEditorElement({ tagName: 'INPUT', innerText: '{"a":1}' }), false);
    });
});

describe('mapThroughFormat', () => {
    const pretty = '{\n  "a": 1\n}';

    it('keeps end-of-content caret at the end after growth', () => {
        // completion typing: caret after } in compact form
        const at = mapThroughFormat('{"a":1}', 7, pretty);
        assert.equal(pretty.slice(0, at).replace(/\s+/g, ''), '{"a":1}');
        assert.equal(at, pretty.length);
    });

    it('maps mid-text carets by content, not raw offset', () => {
        // caret right after the colon in compact form
        const at = mapThroughFormat('{"a":1}', 5, pretty);
        assert.equal(pretty.slice(0, at), '{\n  "a":');
    });

    it('maps an indented caret to the content edge', () => {
        // caret between indent spaces sits after { content-wise
        const at = mapThroughFormat('{\n  "a": 1\n}', 3, pretty);
        assert.equal(at, 1);
        assert.equal(pretty.slice(0, at), '{');
    });

    it('starts at zero for empty prefix', () => {
        assert.equal(mapThroughFormat('{"a":1}', 0, pretty), 0);
    });

    it('carries the caret across spaces inside strings', () => {
        const indented = '{\n  "a b": 1\n}';
        const at = mapThroughFormat('{"a b":1}', 4, indented);
        assert.equal(indented.slice(0, at), '{\n  "a ');
    });
});

describe('diffPrettyLines', () => {
    it('marks identical text all same', () => {
        const rows = diffPrettyLines('{\n  "a": 1\n}', '{\n  "a": 1\n}');
        assert.ok(rows.length > 0);
        assert.ok(rows.every((r) => r.op === ' '));
    });

    it('marks primitive one-line change as del+add', () => {
        const rows = diffPrettyLines('"hello"', '"world"');
        assert.deepEqual(rows, [
            { op: '-', text: '"hello"' },
            { op: '+', text: '"world"' },
        ]);
    });

    it('tones only changed lines in objects', () => {
        const rows = diffPrettyLines('{\n  "a": 1,\n  "b": 2\n}', '{\n  "a": 1,\n  "b": 3\n}');
        const del = rows.filter((r) => r.op === '-');
        const add = rows.filter((r) => r.op === '+');
        assert.equal(del.length, 1);
        assert.equal(add.length, 1);
        assert.ok(del[0].text.includes('"b": 2'));
        assert.ok(add[0].text.includes('"b": 3'));
    });
});
