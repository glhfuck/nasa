// Key-state derivation and ordering. Pure except for reading the store.
// States: green (in DB & code, types match), yellow (code only),
// gray (DB only), red (type mismatch).

import { DB_ONLY_GROUP, store } from './store.js';

export const stateOrder = { red: 0, yellow: 1, green: 2, gray: 3, unknown: 4 };

// Sort order inside a registry: bool, int, float, string, array, map (object), null.
// Keys without registry info (e.g. DB-only) go last.
const registryTypeOrder = { bool: 0, int: 1, float: 2, string: 3, duration: 4, array: 5, object: 6, null: 7 };

// JSON value types mapped onto the registry type order
// (JSON numbers cover both int and float).
const jsonTypeOrder = { boolean: 0, number: 1, string: 3, array: 4, object: 5, null: 6 };

// Server state wins whenever the key came from a payload (always, in
// prod): the backend Validates against the real Go types, which the client
// cannot reproduce (float-in-int, uint range, nested mismatch, time.Time).
// The local computation below is a fallback for hand-built stores (tests).
export function getState(key, dbValue, regInfo) {
    if (store.states && key in store.states) {
        return store.states[key];
    }
    const inDB = store.dbKeys && store.dbKeys[key];
    const inCode = key in store.registries;

    if (inDB && inCode) {
        // The in-memory value always matches the code type (failed DB
        // updates are rejected), so only the raw DB value can mismatch.
        const dbType = getDBRawType(key, dbValue);
        const codeType = regInfo ? normalizeType(regInfo.type) : 'unknown';
        if (typesMatch(dbType, codeType)) {
            return 'green';
        }
        return 'red';
    }
    if (!inDB && inCode) {
        return 'yellow';
    }
    if (inDB && !inCode) {
        return 'gray';
    }
    return 'unknown';
}

export function getJSONType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    return typeof value;  // string, number, boolean
}

// parseDBRaw returns the JSON-parsed raw DB value for a key.
// Non-JSON text stored in DB is treated as a plain string.
export function parseDBRaw(key) {
    if (store.dbRawValues && key in store.dbRawValues) {
        try {
            return { found: true, value: JSON.parse(store.dbRawValues[key]) };
        } catch (e) {
            return { found: true, value: store.dbRawValues[key] };
        }
    }
    return { found: false, value: undefined };
}


export function getDBRawType(key, fallback) {
    const raw = parseDBRaw(key);
    if (raw.found) return getJSONType(raw.value);
    return getJSONType(fallback);
}

export function normalizeType(type) {
    const map = {
        'string': 'string',
        'duration': 'string',
        'int': 'number',
        'float': 'number',
        'bool': 'boolean',
        'array': 'array',
        'object': 'object',
        'null': 'null'
    };
    return map[type] || type;
}

export function typesMatch(dbType, codeType) {
    if (dbType === codeType) return true;
    if ((dbType === 'number' || dbType === 'int') && (codeType === 'number' || codeType === 'int')) return true;
    return false;
}

function stateRank(key, data) {
    const st = getState(key, data ? data[key] : undefined, store.registries[key]);
    return st in stateOrder ? stateOrder[st] : 99;
}

function dbJsonTypeRank(t) {
    return t in jsonTypeOrder ? jsonTypeOrder[t] : 99;
}

function typeRank(key) {
    const info = store.registries[key];
    if (info) {
        return info.type in registryTypeOrder ? registryTypeOrder[info.type] : 99;
    }
    // DB-only keys have no registry type; rank by the raw DB value type.
    const raw = parseDBRaw(key);
    if (raw.found) {
        return dbJsonTypeRank(getJSONType(raw.value));
    }
    return 99;
}

export function groupByRegistry(allKeys, data) {
    const groups = {};

    allKeys.forEach(key => {
        const regInfo = store.registries[key];
        const regName = regInfo ? regInfo.registry : DB_ONLY_GROUP;
        if (!groups[regName]) groups[regName] = [];
        groups[regName].push(key);
    });

    // Sort keys within each registry: state first (red, yellow, green...),
    // then type, then alphabetically.
    Object.keys(groups).forEach(reg => groups[reg].sort((a, b) =>
        (stateRank(a, data) - stateRank(b, data)) ||
        (typeRank(a) - typeRank(b)) ||
        (a < b ? -1 : a > b ? 1 : 0)));

    return groups;
}

// Red/yellow row counts per registry group (header badges).
export function groupStateCounts(items, data) {
    let red = 0, yellow = 0;
    for (const key of items) {
        const st = getState(key, data[key], store.registries[key]);
        if (st === 'red') red++;
        else if (st === 'yellow') yellow++;
    }
    return { red, yellow };
}
