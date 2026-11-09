package ui

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestGetKeysEnrichedShape(t *testing.T) {
	reg := testGroup()
	store := testStore()
	store.rows["gray"] = "[1,2]"
	h := newConfigUI(store, reg).handler

	entries := getKeys(t, h)
	if len(entries) != 4 {
		t.Fatalf("got len %d, want 4", len(entries))
	}

	str := entryByKey(t, entries, "str")
	if str["group"] != "" {
		t.Fatalf("group: got %v, want %v", str["group"], "")
	}
	if str["type"] != "string" {
		t.Fatalf("type: got %v, want %v", str["type"], "string")
	}
	if str["value"] != "hello" {
		t.Fatalf("value: got %v, want %v", str["value"], "hello")
	}
	if str["dbRaw"] != `"hello"` {
		t.Fatalf("dbRaw: got %v, want %v", str["dbRaw"], `"hello"`)
	}
	if str["state"] != "green" {
		t.Fatalf("state: got %v, want %v", str["state"], "green")
	}

	// Red rows show the DB raw value, never pulled memory.
	bad := entryByKey(t, entries, "bad")
	if bad["state"] != "red" {
		t.Fatalf("state: got %v, want %v", bad["state"], "red")
	}
	if bad["value"] != "oops" {
		t.Fatalf("value: got %v, want %v", bad["value"], "oops")
	}
	if bad["dbRaw"] != `"oops"` {
		t.Fatalf("dbRaw: got %v, want %v", bad["dbRaw"], `"oops"`)
	}

	gray := entryByKey(t, entries, "gray")
	if gray["group"] != "DB only" {
		t.Fatalf("group: got %v, want %v", gray["group"], "DB only")
	}
	if gray["state"] != "gray" {
		t.Fatalf("state: got %v, want %v", gray["state"], "gray")
	}
	if !reflect.DeepEqual(gray["value"], []any{1.0, 2.0}) {
		t.Fatalf("value: got %#v, want %#v", gray["value"], []any{1.0, 2.0})
	}
}

func TestGetKeysStateMatrix(t *testing.T) {
	reg := testGroup()
	store := testStore()
	delete(store.rows, "num") // code-only key: yellow until someone PUTs a value
	h := newConfigUI(store, reg).handler

	entries := getKeys(t, h)
	if entryByKey(t, entries, "bad")["state"] != "red" {
		t.Fatalf("bad state: got %v, want %v", entryByKey(t, entries, "bad")["state"], "red")
	}
	if entryByKey(t, entries, "str")["state"] != "green" {
		t.Fatalf("str state: got %v, want %v", entryByKey(t, entries, "str")["state"], "green")
	}

	num := entryByKey(t, entries, "num")
	if num["state"] != "yellow" {
		t.Fatalf("state: got %v, want %v", num["state"], "yellow")
	}
	if num["value"] != nil {
		t.Fatalf("expected nil value, got %v", num["value"])
	}
	if num["type"] != "int" {
		t.Fatalf("type: got %v, want %v", num["type"], "int")
	}
}

func TestExternalFloatIntoIntIsRed(t *testing.T) {
	reg := testGroup()
	store := testStore()
	// Written bypassing UI validation: encoding/json rejects 1.5 for int,
	// so the poller can never apply it — must surface as red, not green.
	store.rows["num"] = "1.5"
	h := newConfigUI(store, reg).handler

	entries := getKeys(t, h)
	num := entryByKey(t, entries, "num")
	if num["state"] != "red" {
		t.Fatalf("state: got %v, want %v", num["state"], "red")
	}
	if !reflect.DeepEqual(num["value"], 1.5) {
		t.Fatalf("value: got %#v, want %#v", num["value"], 1.5)
	}
	if num["dbRaw"] != "1.5" {
		t.Fatalf("dbRaw: got %v, want %v", num["dbRaw"], "1.5")
	}
}

func TestBigIntKeepsPrecision(t *testing.T) {
	reg := testGroup()
	store := testStore()
	store.rows["num"] = "9223372036854775807"
	h := newConfigUI(store, reg).handler

	req, _ := http.NewRequest("GET", "/ui/api/keys", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusOK)
	}
	// Exact digits on the wire, not 9.223372036854776e+18.
	if !strings.Contains(rr.Body.String(), `"value":9223372036854775807`) {
		t.Fatalf("expected body to contain %q", `"value":9223372036854775807`)
	}

	entries := getKeys(t, h)
	num := entryByKey(t, entries, "num")
	if num["state"] != "green" {
		t.Fatalf("state: got %v, want %v", num["state"], "green")
	}
	if num["type"] != "int" {
		t.Fatalf("type: got %v, want %v", num["type"], "int")
	}
}

func TestGetKeysDBErrorIs500(t *testing.T) {
	for _, tc := range []struct {
		name     string
		fetchErr string
		mustHide string
	}{
		{"plain error", "db down", "db down"},
		{"schema detail", `relation t_nasa does not exist`, "t_nasa"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reg := testGroup()
			store := testStore()
			store.fetchErr = errors.New(tc.fetchErr)
			h := newConfigUI(store, reg).handler

			req, _ := http.NewRequest("GET", "/ui/api/keys", nil)
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, req)

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
		})
	}
}
