package ui

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
)

// maxPutBodyBytes caps PUT bodies: values are small JSON documents,
// an unbounded read is a memory-exhaustion vector.
const maxPutBodyBytes = 1 << 20

// putKey implements DB-first writes: Validate -> Persist.
// The handler never touches memory; the poller picks the value up on its
// next tick.
func (u *configUI) putKey(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if key == "" {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "Key required"})
		return
	}
	if !validKey(key) {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "Invalid key: use non-empty segments separated by single /"})
		return
	}
	if !isJSONContentType(r.Header.Get("Content-Type")) {
		writeJSONStatus(w, http.StatusUnsupportedMediaType, map[string]any{"error": "Content-Type must be application/json"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxPutBodyBytes)
	var body any
	if err := readJSON(r, &body); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeJSONStatus(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "body too large"})
			return
		}
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "Invalid JSON"})
		return
	}
	data, _ := json.Marshal(body)

	k, known := u.findKey(key)
	// Unknown anywhere (neither registry nor DB knows this key): PUT
	// creates it as a new DB-only key. DB-only keys skip Validate —
	// any valid JSON is accepted.
	if known {
		if err := k.Validate(data); err != nil {
			writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
			return
		}
	}

	if err := u.store.Persist(r.Context(), key, string(data)); err != nil {
		writeInternalError(w, r, err)
		return
	}
	writeJSON(w, map[string]any{"success": true, "key": key})
}

// isJSONContentType accepts application/json, with or without parameters
// (charset and friends). Anything else — including a missing header —
// is a 415: the body can only be a JSON document.
func isJSONContentType(ct string) bool {
	mt, _, err := mime.ParseMediaType(ct)
	return err == nil && mt == "application/json"
}

// validKey mirrors the frontend rule: slash-joined non-empty segments,
// no . or .. (the router would normalize those into redirects, and the
// tree would render empty folder names).
func validKey(key string) bool {
	if key == "" {
		return false
	}
	for _, seg := range strings.Split(key, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return false
		}
	}
	return true
}

// readJSON decodes one JSON document with UseNumber (keeps the original
// literal: without it every number becomes float64, silently corrupting
// int64/uint64 past 2^53 on re-marshal).
func readJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.UseNumber()
	if err := dec.Decode(v); err != nil {
		return err
	}
	// A single Decode accepts trailing garbage ("100 garbage" persists
	// 100): refuse anything past the first JSON document.
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return errors.New("unexpected trailing data")
	}
	return nil
}
