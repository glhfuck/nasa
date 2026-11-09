package ui

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPutValidatesAndPersists(t *testing.T) {
	reg := testGroup()
	store := testStore()
	h := newConfigUI(store, reg).handler

	rr := doPut(t, h, "num", `100`, "application/json")

	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusOK)
	}
	if store.rows["num"] != "100" {
		t.Fatalf("got %q, want %q", store.rows["num"], "100")
	}
	var result map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["success"] != true {
		t.Fatalf("got %v, want %v", result["success"], true)
	}
}

func TestPutBadTypeIs400AndSkipsPersist(t *testing.T) {
	reg := testGroup()
	store := testStore()
	h := newConfigUI(store, reg).handler

	rr := doPut(t, h, "num", `"oops"`, "application/json")

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusBadRequest)
	}
	if store.rows["num"] != "42" {
		t.Fatalf("bad value must not reach the DB: got %q, want %q", store.rows["num"], "42")
	}
	var result map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	errStr := fmt.Sprint(result["error"])
	if !strings.Contains(errStr, "cannot unmarshal") {
		t.Fatalf("expected %q to contain %q", errStr, "cannot unmarshal")
	}
}

func TestPutUnknownKeyCreatesDBOnly(t *testing.T) {
	reg := testGroup()
	store := testStore()
	h := newConfigUI(store, reg).handler

	rr := doPut(t, h, "brand/new", `{"a":1}`, "application/json")

	if rr.Code != http.StatusOK {
		t.Fatalf("PUT of an unknown key creates a DB-only key: got %d, want %d", rr.Code, http.StatusOK)
	}
	if store.rows["brand/new"] != `{"a":1}` {
		t.Fatalf("got %q, want %q", store.rows["brand/new"], `{"a":1}`)
	}
	var result map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["success"] != true {
		t.Fatalf("got %v, want %v", result["success"], true)
	}
}

func TestPutInvalidJSONIs400(t *testing.T) {
	reg := testGroup()
	h := newConfigUI(testStore(), reg).handler

	rr := doPut(t, h, "num", `{bad`, "application/json")

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestPutGrayKeySkipsValidate(t *testing.T) {
	reg := testGroup()
	store := testStore()
	store.rows["gray"] = `"old"`
	h := newConfigUI(store, reg).handler

	rr := doPut(t, h, "gray", `[1]`, "application/json")

	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusOK)
	}
	if store.rows["gray"] != "[1]" {
		t.Fatalf("got %q, want %q", store.rows["gray"], "[1]")
	}
}

func TestPutTrailingGarbageIs400(t *testing.T) {
	reg := testGroup()
	store := testStore()
	h := newConfigUI(store, reg).handler

	rr := doPut(t, h, "num", `100 garbage`, "application/json")

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusBadRequest)
	}
	if store.rows["num"] != "42" {
		t.Fatalf("trailing garbage must not reach the DB: got %q, want %q", store.rows["num"], "42")
	}
}

func TestNewConfigUINilStorePanics(t *testing.T) {
	reg := testGroup()
	assertPanics(t, func() { newConfigUI(nil, reg) })
}

func TestPutPersistErrorIs500(t *testing.T) {
	for _, tc := range []struct {
		name       string
		persistErr string
		mustHide   string
	}{
		{"infra detail", `dial tcp 127.0.0.1:5432: connect: connection refused`, "127.0.0.1"},
		{"plain error", "db down", "db down"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reg := testGroup()
			store := testStore()
			store.persist = func(string, string) error { return errors.New(tc.persistErr) }
			h := newConfigUI(store, reg).handler

			rr := doPut(t, h, "num", `100`, "application/json")

			if rr.Code != http.StatusInternalServerError {
				t.Fatalf("got %d, want %d", rr.Code, http.StatusInternalServerError)
			}
			var result map[string]any
			if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			errStr := fmt.Sprint(result["error"])
			if strings.Contains(errStr, tc.mustHide) {
				t.Fatalf("error detail %q must be hidden", tc.mustHide)
			}
			if result["error"] != "internal error" {
				t.Fatalf("got %v, want %v", result["error"], "internal error")
			}
			if store.rows["num"] != "42" {
				t.Fatalf("failed persist must not touch the DB: got %q, want %q", store.rows["num"], "42")
			}
		})
	}
}

func TestPutNumbersRoundTrip(t *testing.T) {
	for _, tc := range []struct {
		name      string
		build     func(t *testing.T) (Group, *fakeStore)
		key, body string
	}{
		{
			name: "int64 past 2^53 keeps precision",
			build: func(t *testing.T) (Group, *fakeStore) {
				reg := Group{Name: "", Keys: map[string]Key{"big": keyFor[int64]()}}
				return reg, &fakeStore{rows: map[string]string{"big": "0"}}
			},
			key: "big", body: `9223372036854775807`,
		},
		{
			name: "gray int64 keeps precision",
			build: func(t *testing.T) (Group, *fakeStore) {
				reg := testGroup()
				store := testStore()
				store.rows["gray"] = "0"
				return reg, store
			},
			key: "gray", body: `9223372036854775807`,
		},
		{
			name: "float passes through",
			build: func(t *testing.T) (Group, *fakeStore) {
				reg := Group{Name: "", Keys: map[string]Key{"f": keyFor[float64]()}}
				return reg, &fakeStore{rows: map[string]string{"f": "0"}}
			},
			key: "f", body: `3.14`,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reg, store := tc.build(t)
			h := newConfigUI(store, reg).handler

			rr := doPut(t, h, tc.key, tc.body, "application/json")

			if rr.Code != http.StatusOK {
				t.Fatalf("got %d, want %d (body: %s)", rr.Code, http.StatusOK, rr.Body.String())
			}
			if store.rows[tc.key] != tc.body {
				t.Fatalf("got %q, want %q", store.rows[tc.key], tc.body)
			}
		})
	}
}

func TestPutHugeBodyIs413(t *testing.T) {
	reg := testGroup()
	store := testStore()
	h := newConfigUI(store, reg).handler

	big := `"` + strings.Repeat("x", 2<<20) + `"`
	rr := doPut(t, h, "str", big, "application/json")

	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusRequestEntityTooLarge)
	}
	var result map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	errStr := fmt.Sprint(result["error"])
	if !strings.Contains(errStr, "too large") {
		t.Fatalf("expected %q to contain %q", errStr, "too large")
	}
	if store.rows["str"] != `"hello"` {
		t.Fatalf("oversized body must not reach the DB: got %q, want %q", store.rows["str"], `"hello"`)
	}
}

func TestPutWrongContentTypeIs415(t *testing.T) {
	for _, tc := range []struct{ name, contentType string }{
		{"text/plain", "text/plain"},
		{"missing", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reg := testGroup()
			store := testStore()
			h := newConfigUI(store, reg).handler

			rr := doPut(t, h, "num", `100`, tc.contentType)

			if rr.Code != http.StatusUnsupportedMediaType {
				t.Fatalf("got %d, want %d", rr.Code, http.StatusUnsupportedMediaType)
			}
			if store.rows["num"] != "42" {
				t.Fatalf("wrong content type must not reach the DB: got %q, want %q", store.rows["num"], "42")
			}
		})
	}
}

func TestPutCharsetContentTypeAccepted(t *testing.T) {
	reg := testGroup()
	store := testStore()
	h := newConfigUI(store, reg).handler

	rr := doPut(t, h, "num", `100`, "application/json; charset=utf-8")

	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusOK)
	}
	if store.rows["num"] != "100" {
		t.Fatalf("got %q, want %q", store.rows["num"], "100")
	}
}

func TestPutMissingKeyIsJSONError(t *testing.T) {
	reg := testGroup()
	h := newConfigUI(testStore(), reg).handler

	req, _ := http.NewRequest("PUT", "/ui/api/keys/", strings.NewReader(`1`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusBadRequest)
	}
	if got := rr.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("got %q, want %q", got, "application/json")
	}
}

func TestPutEncodedSlashKey(t *testing.T) {
	reg := testGroup()
	store := testStore()
	h := newConfigUI(store, reg).handler

	// Keys travel URL-encoded (slashes become %2F); the server decodes.
	rr := doPut(t, h, "a%2Fb", `7`, "application/json")

	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want %d (body: %s)", rr.Code, http.StatusOK, rr.Body.String())
	}
	if store.rows["a/b"] != "7" {
		t.Fatalf("got %q, want %q", store.rows["a/b"], "7")
	}
}

func TestPutInvalidKeyIs400(t *testing.T) {
	reg := testGroup()
	store := testStore()

	for _, key := range []string{"app//flag", "/app/flag", "app/flag/", "app/./flag", "app/../flag"} {
		req, _ := http.NewRequest("PUT", "/ui/api/keys/x", strings.NewReader(`1`))
		req.Header.Set("Content-Type", "application/json")
		// SetPathValue bypasses mux path cleaning, which would 301
		// dot-segments before the handler ever sees them.
		req.SetPathValue("key", key)
		rr := httptest.NewRecorder()
		// Call the handler directly: the mux would redirect // and ..
		// instead of routing them here.
		u := &configUI{groups: []Group{reg}, store: store}
		u.putKey(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("key %q: got %d, want %d", key, rr.Code, http.StatusBadRequest)
		}
		var result map[string]any
		if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		errStr := fmt.Sprint(result["error"])
		if !strings.Contains(errStr, "Invalid key") {
			t.Fatalf("expected %q to contain %q", errStr, "Invalid key")
		}
	}
}
