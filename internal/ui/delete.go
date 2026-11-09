package ui

import (
	"database/sql"
	"errors"
	"net/http"
)

func (u *configUI) deleteKey(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if key == "" {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "Key required"})
		return
	}
	// Deleting a DB-only (gray) key removes it completely; deleting a
	// registry key removes its DB override so it reverts to the code default.
	if err := u.store.Delete(r.Context(), key); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSONStatus(w, http.StatusNotFound, map[string]any{"error": "Key not found"})
			return
		}
		writeInternalError(w, r, err)
		return
	}
	writeJSON(w, map[string]any{"success": true, "key": key})
}
