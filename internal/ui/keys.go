package ui

import (
	"maps"
	"net/http"
	"slices"
	"strings"
)

type keyEntry struct {
	Key         string `json:"key"`
	Group       string `json:"group"`
	Type        string `json:"type"` // Go type name (string, int, bool, etc.)
	Value       any    `json:"value"`
	DBRaw       string `json:"dbRaw"`       // raw DB JSON text, "" when absent
	DefaultRaw  string `json:"defaultRaw"`  // raw JSON of compiled-in default, "" for DB-only
	Description string `json:"description"` // optional human-readable description from desc tag
	State       string `json:"state"`       // red|yellow|green|gray
}

// Values come exclusively from a live database read. A registry key
// without a row renders as yellow null (code only) until PUT creates it.
func (u *configUI) handleKeys(w http.ResponseWriter, r *http.Request) {
	db, err := u.store.Fetch(r.Context())
	if err != nil {
		writeInternalError(w, r, err)
		return
	}

	known := make(map[string]bool)
	entries := make([]keyEntry, 0, len(db))

	sorted := append([]Group(nil), u.groups...)
	slices.SortFunc(sorted, func(a, b Group) int { return strings.Compare(a.Name, b.Name) })

	for _, g := range sorted {
		for _, k := range slices.Sorted(maps.Keys(g.Keys)) {
			known[k] = true
			entries = append(entries, entryFor(g, k, db))
		}
	}

	var gray []string
	for k := range db {
		if !known[k] {
			gray = append(gray, k)
		}
	}
	slices.Sort(gray)
	for _, k := range gray {
		entries = append(entries, grayEntry(k, db[k]))
	}

	writeJSON(w, entries)
}

func entryFor(group Group, key string, db map[string]string) keyEntry {
	k := group.Keys[key]
	typ := "unknown"
	if k.Type != nil {
		typ = typeDisplayName(k.Type)
	}
	entry := keyEntry{
		Key:         key,
		Group:       group.Name,
		Type:        typ,
		DefaultRaw:  k.DefaultRaw,
		Description: k.Description,
	}
	raw, inDB := db[key]
	if !inDB {
		entry.State = "yellow"
		return entry
	}
	entry.Value = decodeRaw(raw)
	entry.DBRaw = raw
	// Validate against the registry type to match poller behavior.
	if err := k.Validate([]byte(raw)); err != nil {
		entry.State = "red"
	} else {
		entry.State = "green"
	}
	return entry
}

func grayEntry(key, raw string) keyEntry {
	value := decodeRaw(raw)
	return keyEntry{Key: key, Group: "DB only", Type: inferTypeInfo(value), Value: value, DBRaw: raw, State: "gray"}
}
