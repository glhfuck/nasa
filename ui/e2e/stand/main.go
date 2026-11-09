// E2E demo stand: sqlite-backed nasa registry plus the config UI on a
// throwaway file DB. Used only by ui/e2e tests (never shipped): seeds one
// of every row state — green, yellow (missing in DB), red (DB/code type
// mismatch), gray (DB-only, deletable).
package main

import (
	"context"
	"database/sql"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/glhfuck/nasa"
	_ "modernc.org/sqlite"
)

type AppConfig struct {
	Title       nasa.UFO[string] `nasa:"title"`
	Enabled     nasa.UFO[bool]   `nasa:"enabled"`
	MissingFlag nasa.UFO[bool]   `nasa:"missing/flag"`
	BrokenCount nasa.UFO[int]    `nasa:"broken/count"`
}

func main() {
	addr := flag.String("addr", "127.0.0.1:18080", "listen address")
	flag.Parse()

	tmp, err := os.CreateTemp("", "nasa-e2e-*.sqlite")
	if err != nil {
		slog.Error("temp db", "error", err)
		os.Exit(1)
	}
	path := tmp.Name()
	tmp.Close()
	defer os.Remove(path)

	db, err := sql.Open("sqlite", path)
	if err != nil {
		slog.Error("open db", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if _, err := db.Exec(`CREATE TABLE t_nasa (key TEXT PRIMARY KEY, value TEXT NOT NULL)`); err != nil {
		slog.Error("migrate", "error", err)
		os.Exit(1)
	}
	if _, err := db.Exec(`INSERT INTO t_nasa (key, value) VALUES
		('app/title', '"hello"'),
		('app/enabled', 'true'),
		('app/broken/count', '"oops"'),
		('zz/notes', '"hi"')`); err != nil {
		slog.Error("seed", "error", err)
		os.Exit(1)
	}

	cfg := &AppConfig{
		Title:       nasa.New("hello"),
		Enabled:     nasa.New(true),
		MissingFlag: nasa.New(false),
		BrokenCount: nasa.New(3),
	}
	registry, err := nasa.BuildRegistry(cfg, "app")
	if err != nil {
		slog.Error("registry", "error", err)
		os.Exit(1)
	}

	// Fast tick so tests asserting poller-applied values don't sleep.
	poller, err := nasa.NewPoller(db, 200*time.Millisecond, registry)
	if err != nil {
		slog.Error("poller", "error", err)
		os.Exit(1)
	}
	ctx := context.Background()
	if err := poller.Start(ctx); err != nil {
		slog.Error("poller start", "error", err)
		os.Exit(1)
	}

	mux := http.NewServeMux()
	handler := nasa.ServeUI(db, mux, registry)
	slog.Info("e2e stand up", "addr", *addr)
	if err := http.ListenAndServe(*addr, handler); err != nil {
		slog.Error("serve", "error", err)
		os.Exit(1)
	}
}
