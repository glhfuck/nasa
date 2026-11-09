package ui

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

func writeJSON(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	// Embedded assets carry no modtime (see buildHandler): without
	// no-store, intermediaries may heuristically cache API responses.
	w.Header().Set("Cache-Control", "no-store")
	encodeJSON(w, data)
}

func writeJSONStatus(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	encodeJSON(w, data)
}

// writeInternalError answers 500 with a generic message and logs the
// details server-side: driver errors carry infra layout (hosts, users,
// schema and constraint names) that must never reach clients.
func writeInternalError(w http.ResponseWriter, r *http.Request, err error) {
	slog.Error("UI backend failure", "method", r.Method, "path", r.URL.Path, "error", err)
	writeJSONStatus(w, http.StatusInternalServerError, map[string]any{"error": "internal error"})
}

// encodeJSON writes the body; Encode is the only step that can fail here
// (e.g. NaN), and headers are already sent, so all we can do is log it.
func encodeJSON(w http.ResponseWriter, data any) {
	if err := json.NewEncoder(w).Encode(data); err != nil {
		slog.Error("failed to encode UI response", "error", err)
	}
}
