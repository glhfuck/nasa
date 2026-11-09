package nasa

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type serveCfg struct {
	Limits serveLimits `nasa:"limits"`
}

type serveLimits struct {
	MaxRPS UFO[int] `nasa:"max/rps" desc:"Max RPS limit"`
}

func serveTestSetup(t *testing.T) (http.Handler, UFO[int]) {
	t.Helper()
	src := &fakeSource{values: map[string]string{"app/limits/max/rps": "100"}}

	cfg := &serveCfg{}
	reg, err := BuildRegistry(cfg, "app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	poller, err := newPollerWithSource(src, time.Hour, reg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := poller.Start(t.Context()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/ping", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("pong")) })
	return serveUIWithSource(src, mux, reg), cfg.Limits.MaxRPS
}

func TestServeUIWiring(t *testing.T) {
	h, maxRPS := serveTestSetup(t)

	// Panel + API served under /ui, rest forwarded.
	for _, tc := range []struct{ path, want string }{
		{"/ui", "Dynamic Config Manager"},
		{"/ping", "pong"},
	} {
		path, want := tc.path, tc.want
		req, _ := http.NewRequest("GET", path, nil)
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("got %d for %s, want %d", rr.Code, path, http.StatusOK)
		}
		if !strings.Contains(rr.Body.String(), want) {
			t.Fatalf("expected %q to contain %q", rr.Body.String(), want)
		}
	}

	// PUT flows Validate -> Persist. Memory is untouched:
	// the UI reads the DB, the app picks the value up on the next tick.
	req, _ := http.NewRequest("PUT", "/ui/api/keys/app/limits/max/rps", strings.NewReader(`201`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusOK)
	}
	if maxRPS.Get() != 100 {
		t.Fatalf("PUT must not touch memory: got %d, want 100", maxRPS.Get())
	}
	if got := apiDBRawValue(t, h); got != "201" {
		t.Fatalf("got %q, want %q", got, "201")
	}
}

func apiDBRawValue(t *testing.T, h http.Handler) string {
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
	for _, e := range entries {
		if e["key"] == "app/limits/max/rps" {
			if e["group"] != "app" {
				t.Fatalf("registry name doubles as group label: got %v, want %v", e["group"], "app")
			}
			if e["state"] != "green" {
				t.Fatalf("got %v, want %v", e["state"], "green")
			}
			if e["description"] != "Max RPS limit" {
				t.Fatalf("got %v, want %v", e["description"], "Max RPS limit")
			}
			return e["dbRaw"].(string)
		}
	}
	t.Fatal("entry missing")
	return ""
}

func TestNoStoreHeaders(t *testing.T) {
	h, _ := serveTestSetup(t)
	for _, path := range []string{"/ui", "/ui/api/keys", "/ui/static/js/main.js"} {
		req, _ := http.NewRequest("GET", path, nil)
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("got %d for %s, want %d", rr.Code, path, http.StatusOK)
		}
		if got := rr.Header().Get("Cache-Control"); got != "no-store" {
			t.Fatalf("got %q for %s, want %q", got, path, "no-store")
		}
	}
}

func TestWrongMethodOnKeyIsJSON405(t *testing.T) {
	h, _ := serveTestSetup(t)
	req, _ := http.NewRequest("POST", "/ui/api/keys/app/limits/max/rps", strings.NewReader(`1`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusMethodNotAllowed)
	}
	if !strings.Contains(rr.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("expected %q to contain %q", rr.Header().Get("Content-Type"), "application/json")
	}
}

func TestUITrailingSlashRedirects(t *testing.T) {
	h, _ := serveTestSetup(t)
	req, _ := http.NewRequest("GET", "/ui/", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusMovedPermanently {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusMovedPermanently)
	}
	if got := rr.Header().Get("Location"); got != "/ui" {
		t.Fatalf("got %q, want %q", got, "/ui")
	}
}

func TestServeUIPanicsOnNil(t *testing.T) {
	cfg := &serveCfg{}
	reg, err := BuildRegistry(cfg, "app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	assertPanics(t, func() { ServeUI(nil, http.NewServeMux(), reg) })
	assertPanics(t, func() { ServeUI(&sql.DB{}, nil, reg) })
}

func TestServeUIDurationKey(t *testing.T) {
	src := &fakeSource{values: map[string]string{"app/timeout": `"5s"`}}

	var cfg struct {
		Timeout UFO[time.Duration] `nasa:"timeout"`
	}
	reg, err := BuildRegistry(&cfg, "app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	h := serveUIWithSource(src, http.NewServeMux(), reg)

	// GET /ui/api/keys reports type "duration" and state "green".
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
	if len(entries) != 1 {
		t.Fatalf("got len %d, want 1", len(entries))
	}
	if entries[0]["type"] != "duration" {
		t.Fatalf("got %v, want %v", entries[0]["type"], "duration")
	}
	if entries[0]["state"] != "green" {
		t.Fatalf("got %v, want %v", entries[0]["state"], "green")
	}
	if entries[0]["value"] != "5s" {
		t.Fatalf("got %v, want %v", entries[0]["value"], "5s")
	}

	// PUT valid duration string succeeds.
	req, _ = http.NewRequest("PUT", "/ui/api/keys/app/timeout", strings.NewReader(`"15s"`))
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusOK)
	}

	// PUT bare number into duration key is 400 Bad Request.
	req, _ = http.NewRequest("PUT", "/ui/api/keys/app/timeout", strings.NewReader(`15`))
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestServeUIYellowCarriesDefaultRaw(t *testing.T) {
	src := &fakeSource{values: map[string]string{}}

	type Svc struct {
		Host string `json:"host"`
		Port int    `json:"port"`
	}
	cfg := &struct {
		RPS  UFO[int]    `nasa:"rps"`
		Svc  UFO[Svc]    `nasa:"svc"`
		Name UFO[string] `nasa:"name"`
	}{RPS: New(200)}
	reg, err := BuildRegistry(cfg, "app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	h := serveUIWithSource(src, http.NewServeMux(), reg)
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
	if len(entries) != 3 {
		t.Fatalf("got len %d, want 3", len(entries))
	}
	byKey := map[string]map[string]any{}
	for _, e := range entries {
		byKey[e["key"].(string)] = e
	}
	// Absent from DB: yellow, no value/dbRaw, but compiled default present.
	rps := byKey["app/rps"]
	if rps["state"] != "yellow" {
		t.Fatalf("got %v, want %v", rps["state"], "yellow")
	}
	if rps["value"] != nil {
		t.Fatalf("expected nil, got %v", rps["value"])
	}
	if rps["dbRaw"] != "" {
		t.Fatalf("got %v, want %v", rps["dbRaw"], "")
	}
	if rps["defaultRaw"] != "200" {
		t.Fatalf("got %v, want %v", rps["defaultRaw"], "200")
	}
	svc := byKey["app/svc"]
	if svc["state"] != "yellow" {
		t.Fatalf("got %v, want %v", svc["state"], "yellow")
	}
	if svc["defaultRaw"] != `{"host":"","port":0}` {
		t.Fatalf("got %v, want %v", svc["defaultRaw"], `{"host":"","port":0}`)
	}
	if byKey["app/name"]["defaultRaw"] != `""` {
		t.Fatalf("got %v, want %v", byKey["app/name"]["defaultRaw"], `""`)
	}
}

func TestServeUIResetKeyToDefault(t *testing.T) {
	src := &fakeSource{values: map[string]string{"app/limits/max/rps": "100"}}

	cfg := &serveCfg{Limits: serveLimits{MaxRPS: New(50)}}
	reg, err := BuildRegistry(cfg, "app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	poller, err := newPollerWithSource(src, time.Hour, reg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := poller.Start(t.Context()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Limits.MaxRPS.Get() != 100 {
		t.Fatalf("got %d, want 100", cfg.Limits.MaxRPS.Get())
	}

	h := serveUIWithSource(src, http.NewServeMux(), reg)

	// DELETE removes the DB override.
	req, _ := http.NewRequest("DELETE", "/ui/api/keys/app/limits/max/rps", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusOK)
	}

	// UI immediately reports the key as yellow with its compiled-in defaultRaw.
	req, _ = http.NewRequest("GET", "/ui/api/keys", nil)
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusOK)
	}
	var entries []map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &entries); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("got len %d, want 1", len(entries))
	}
	if entries[0]["state"] != "yellow" {
		t.Fatalf("got %v, want %v", entries[0]["state"], "yellow")
	}
	if entries[0]["dbRaw"] != "" {
		t.Fatalf("got %v, want %v", entries[0]["dbRaw"], "")
	}
	if entries[0]["defaultRaw"] != "50" {
		t.Fatalf("got %v, want %v", entries[0]["defaultRaw"], "50")
	}

	// Next synchronous poll tick reverts the in-memory UFO to the initial
	// default (50) without spawning another background goroutine.
	if err := poller.pollOnce(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Limits.MaxRPS.Get() != 50 {
		t.Fatalf("got %d, want 50", cfg.Limits.MaxRPS.Get())
	}
}
