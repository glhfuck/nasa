package ui

import (
	"html/template"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUITemplateStillRenders(t *testing.T) {
	h := newConfigUI(&fakeStore{rows: map[string]string{}}).handler

	req, _ := http.NewRequest("GET", "/ui", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusOK)
	}
	if !strings.Contains(rr.Body.String(), "Dynamic Config Manager") {
		t.Fatalf("expected body to contain %q", "Dynamic Config Manager")
	}
}

func TestUITemplateErrorIs500(t *testing.T) {
	u := newConfigUI(&fakeStore{rows: map[string]string{}})
	u.template = template.Must(template.New("x").Parse("{{.Missing}}"))

	req, _ := http.NewRequest("GET", "/ui", nil)
	rr := httptest.NewRecorder()
	u.handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("got %d, want %d", rr.Code, http.StatusInternalServerError)
	}
}
