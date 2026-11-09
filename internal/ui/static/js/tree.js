// Pure tree helpers for the tree view mode (no DOM access, ESM importable).
//
// A node is { name, children: Map<string, node>, leafKey: string|null }.
// leafKey is set when a full config key ends exactly at this node —
// a node may hold BOTH a leafKey and children (key/prefix collision).

export function newNode(name) {
    return { name, children: new Map(), leafKey: null };
}

// buildTree inserts every full key, splitting on '/'. stripPrefix drops a
// shared leading segment (the registry group name): without it every group
// would open with a folder twin of its own header. leafKey always keeps
// the full key — only the folder skeleton is shortened.
export function buildTree(keys, stripPrefix = '') {
    const root = newNode('');
    for (const key of keys) {
        const parts = key.split('/');
        if (stripPrefix !== '' && parts.length > 1 && parts[0] === stripPrefix) {
            parts.shift();
        }
        let node = root;
        for (const part of parts) {
            let child = node.children.get(part);
            if (!child) {
                child = newNode(part);
                node.children.set(part, child);
            }
            node = child;
        }
        node.leafKey = key;
    }
    return root;
}

export function countLeaves(node) {
    let n = node.leafKey !== null ? 1 : 0;
    for (const child of node.children.values()) n += countLeaves(child);
    return n;
}

// countStates aggregates red/yellow states over the subtree.
// stateOf maps a full config key to its state string.
export function countStates(node, stateOf) {
    let red = 0, yellow = 0;
    if (node.leafKey !== null) {
        const st = stateOf(node.leafKey);
        if (st === 'red') red++;
        else if (st === 'yellow') yellow++;
    }
    for (const child of node.children.values()) {
        const sub = countStates(child, stateOf);
        red += sub.red;
        yellow += sub.yellow;
    }
    return { red, yellow };
}
