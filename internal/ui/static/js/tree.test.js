import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildTree, countLeaves, countStates } from './tree.js';

describe('buildTree', () => {
    it('nests full keys into folders', () => {
        const root = buildTree(['app/limits/max/rps', 'app/limits/timeout']);
        assert.ok(root.children.has('app'));
        const app = root.children.get('app');
        assert.ok(app.children.has('limits'));
        const limits = app.children.get('limits');
        assert.ok(limits.children.has('max'));
        assert.equal(limits.children.get('max').leafKey, null);
        assert.deepEqual(
            [...limits.children.get('max').children.keys()],
            ['rps'],
        );
        assert.equal(limits.children.get('max').children.get('rps').leafKey, 'app/limits/max/rps');
        assert.equal(limits.children.get('timeout').leafKey, 'app/limits/timeout');
    });

    it('keeps both leaf and children on key/prefix collision', () => {
        const root = buildTree(['a/b', 'a/b/c']);
        const b = root.children.get('a').children.get('b');
        assert.equal(b.leafKey, 'a/b');
        assert.equal(b.children.get('c').leafKey, 'a/b/c');
    });

    it('puts single-segment keys at the root', () => {
        const root = buildTree(['flat', 'a/b']);
        assert.equal(root.children.get('flat').leafKey, 'flat');
        assert.equal(root.children.get('flat').children.size, 0);
    });

    it('strips the shared group prefix, keeping full leafKeys', () => {
        const root = buildTree(['app/prefix', 'app/limits/timeout'], 'app');
        assert.ok(!root.children.has('app'), 'no folder twin of the group');
        assert.equal(root.children.get('prefix').leafKey, 'app/prefix');
        assert.equal(
            root.children.get('limits').children.get('timeout').leafKey,
            'app/limits/timeout',
        );
    });

    it('strip leaves foreign and bare keys alone', () => {
        const root = buildTree(['other/x', 'bare', 'app'], 'app');
        assert.ok(root.children.has('other'));
        assert.equal(root.children.get('bare').leafKey, 'bare');
        // Single segment equal to the prefix: nothing to strip to.
        assert.equal(root.children.get('app').leafKey, 'app');
    });
});

describe('aggregation', () => {
    const states = {
        'app/limits/max/rps': 'red',
        'app/limits/timeout': 'green',
        'app/other': 'yellow',
    };
    const stateOf = (key) => states[key] || 'gray';

    it('countLeaves counts every leaf in the subtree', () => {
        const root = buildTree(Object.keys(states));
        assert.equal(countLeaves(root), 3);
        assert.equal(countLeaves(root.children.get('app').children.get('limits')), 2);
        assert.equal(countLeaves(root.children.get('app').children.get('other')), 1);
    });

    it('countStates aggregates red/yellow over the subtree', () => {
        const root = buildTree(Object.keys(states));
        assert.deepEqual(countStates(root, stateOf), { red: 1, yellow: 1 });
        assert.deepEqual(
            countStates(root.children.get('app').children.get('limits'), stateOf),
            { red: 1, yellow: 0 },
        );
    });
});
