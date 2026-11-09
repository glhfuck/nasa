package ui

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func TestDeleteRemovesGrayRow(t *testing.T) {
	reg := testGroup()
	store := testStore()
	store.rows["gray"] = `"old"`
	h := newConfigUI(store, reg).handler

	rr := doDelete(t, h, "gray")

	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusOK)
	}
	if !reflect.DeepEqual(store.deleted, []string{"gray"}) {
		t.Fatalf("got %v, want %v", store.deleted, []string{"gray"})
	}
	if _, stillThere := store.rows["gray"]; stillThere {
		t.Fatal("expected gray to be removed from store")
	}
}

func TestDeleteRegistryKeyRemovesDBOverride(t *testing.T) {
	reg := testGroup()
	store := testStore()
	h := newConfigUI(store, reg).handler

	rr := doDelete(t, h, "num")

	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusOK)
	}
	if !reflect.DeepEqual(store.deleted, []string{"num"}) {
		t.Fatalf("got %v, want %v", store.deleted, []string{"num"})
	}
	if _, stillThere := store.rows["num"]; stillThere {
		t.Fatal("DB override for registry key must be removed")
	}

	// Deleting a yellow (code-only) key with no DB row returns 404.
	rr2 := doDelete(t, h, "num")
	if rr2.Code != http.StatusNotFound {
		t.Fatalf("got %d, want %d", rr2.Code, http.StatusNotFound)
	}
}

func TestDeleteMissingIs404(t *testing.T) {
	reg := testGroup()
	h := newConfigUI(testStore(), reg).handler

	rr := doDelete(t, h, "nope")

	if rr.Code != http.StatusNotFound {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusNotFound)
	}
}

func TestDeleteDBErrorHidesDetails(t *testing.T) {
	reg := testGroup()
	store := testStore()
	store.rows["gray"] = `"old"`
	store.deleteErr = errors.New(`pq: password authentication failed for user "postgres"`)
	h := newConfigUI(store, reg).handler

	rr := doDelete(t, h, "gray")

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusInternalServerError)
	}
	var result map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	errStr := fmt.Sprint(result["error"])
	if strings.Contains(errStr, "postgres") {
		t.Fatalf("error detail must not name %q", "postgres")
	}
	if result["error"] != "internal error" {
		t.Fatalf("got %v, want %v", result["error"], "internal error")
	}
}
