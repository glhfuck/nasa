package ui

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/glhfuck/nasa/internal/db"
)

// assertPanics fails the test when fn does not panic.
func assertPanics(t *testing.T, fn func()) {
	t.Helper()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic, but function did not panic")
		}
	}()
	fn()
}

type fakeStore struct {
	rows      map[string]string
	persist   func(key string, raw string) error
	fetchErr  error
	deleteErr error
	deleted   []string
}

var _ db.Source = (*fakeStore)(nil)

func (s *fakeStore) Fetch(context.Context) (map[string]string, error) {
	if s.fetchErr != nil {
		return nil, s.fetchErr
	}
	out := make(map[string]string, len(s.rows))
	for k, v := range s.rows {
		out[k] = v
	}
	return out, nil
}
func (s *fakeStore) Persist(_ context.Context, key string, raw string) error {
	if s.persist != nil {
		return s.persist(key, raw)
	}
	s.rows[key] = raw
	return nil
}
func (s *fakeStore) Delete(_ context.Context, key string) error {
	if s.deleteErr != nil {
		return s.deleteErr
	}
	if _, ok := s.rows[key]; !ok {
		return sql.ErrNoRows
	}
	delete(s.rows, key)
	s.deleted = append(s.deleted, key)
	return nil
}

// keyFor builds Key metadata for type T with plain JSON validation.
// Mirrors what nasa.ServeUI derives from a registry: the static type for
// display plus a dry-run decode for writes.
func keyFor[T any]() Key {
	return Key{
		Type: reflect.TypeFor[T](),
		Validate: func(raw []byte) error {
			var v T
			return json.Unmarshal(raw, &v)
		},
	}
}

// testGroup builds the standard group through data, not the registry:
// str (string), num (int), bad (int holding a string in tests).
func testGroup() Group {
	return Group{Name: "", Keys: map[string]Key{
		"str": keyFor[string](),
		"num": keyFor[int](),
		"bad": keyFor[int](),
	}}
}

func testStore() *fakeStore {
	return &fakeStore{rows: map[string]string{
		"str": `"hello"`,
		"num": "42",
		"bad": `"oops"`,
	}}
}

func getKeys(t *testing.T, h http.Handler) []map[string]any {
	t.Helper()
	req, _ := http.NewRequest("GET", "/ui/api/keys", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusOK)
	}
	var entries []map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &entries); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	return entries
}

func entryByKey(t *testing.T, entries []map[string]any, key string) map[string]any {
	t.Helper()
	for _, e := range entries {
		if e["key"] == key {
			return e
		}
	}
	t.Fatalf("entry %q not found in %v", key, entries)
	return nil
}

// doPut issues a PUT through the handler and returns the recorder.
func doPut(t *testing.T, h http.Handler, key, body, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	req, _ := http.NewRequest("PUT", "/ui/api/keys/"+key, strings.NewReader(body))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

// doDelete issues a DELETE through the handler and returns the recorder.
func doDelete(t *testing.T, h http.Handler, key string) *httptest.ResponseRecorder {
	t.Helper()
	req, _ := http.NewRequest("DELETE", "/ui/api/keys/"+key, nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}
