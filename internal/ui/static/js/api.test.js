import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom, resetStore } from './dom-harness.js';
import { putKey, deleteKey, putRawKey } from './api.js';

const realFetch = globalThis.fetch;

beforeEach(() => {
    installDom();
    resetStore();
});

afterEach(() => {
    globalThis.fetch = realFetch;
});

describe('api error bodies', () => {
    it('putKey surfaces the HTTP status when the error body is not JSON', async () => {
        globalThis.fetch = async () => new Response('<html>bad gateway</html>', {
            status: 502,
            headers: { 'Content-Type': 'text/html' },
        });
        await assert.rejects(putKey('app/title', 'x'), /502/);
    });

    it('deleteKey surfaces the HTTP status when the error body is not JSON', async () => {
        globalThis.fetch = async () => new Response('boom', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
        });
        await assert.rejects(deleteKey('zz/old'), /503/);
    });

    it('putKey still reports JSON error details when present', async () => {
        globalThis.fetch = async () => new Response(JSON.stringify({ error: 'nope' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
        await assert.rejects(putKey('app/title', 'x'), /nope/);
    });
});

describe('putRawKey', () => {
    it('sends the raw text verbatim, no float round-trip', async () => {
        let body = null;
        globalThis.fetch = async (url, opts) => {
            body = opts.body;
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        };
        await putRawKey('app/big', '9223372036854775807');
        assert.equal(body, '9223372036854775807');
    });
});
