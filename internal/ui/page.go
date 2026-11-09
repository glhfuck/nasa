package ui

import (
	"bytes"
	"log/slog"
	"net/http"
)

func (u *configUI) serveUI(w http.ResponseWriter, r *http.Request) {
	// Render to a buffer first: streaming straight into w would flush
	// a 200 on the first byte and leave a truncated page on error.
	var buf bytes.Buffer
	if err := u.template.ExecuteTemplate(&buf, "index.html", nil); err != nil {
		slog.Error("UI template failure", "path", r.URL.Path, "error", err)
		http.Error(w, "Failed to render page", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = buf.WriteTo(w)
}
