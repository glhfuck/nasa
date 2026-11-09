import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatArray, formatObject } from './format.js';

// Attribute breakout: a title built with escapeHtml leaves " raw, so a
// DB-controlled string breaks out of title="..." (stored XSS). escapeAttr
// must be used for every double-quoted attribute.
describe('format attribute escaping', () => {
    it('array pill title survives embedded quotes', () => {
        const html = formatArray(['a"b']);
        assert.ok(!html.includes('title=""a'), `broken title attr: ${html}`);
        assert.ok(html.includes('&quot;'), `quotes must be escaped: ${html}`);
    });

    it('array pill title blocks event-handler injection', () => {
        const html = formatArray(['" onmouseover="alert(1)']);
        assert.ok(!html.includes('onmouseover="alert(1)"'), `injection: ${html}`);
    });

    it('object pill title survives embedded quotes', () => {
        const html = formatObject({ k: 'a"b' });
        assert.ok(html.includes('&quot;'), `quotes must be escaped: ${html}`);
    });
});
