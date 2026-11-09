package main

import (
	"context"
	"database/sql"
	"log/slog"
	"os"
	"time"

	"github.com/glhfuck/nasa"
	_ "modernc.org/sqlite"
)

type AppConfig struct {
	Features FeaturesConfig `nasa:"features"`
	Limits   LimitsConfig   `nasa:"limits"`
}

type FeaturesConfig struct {
	EnableNewUI      nasa.UFO[bool]             `nasa:"enable/new/ui"`
	EnableBetaAPI    nasa.UFO[bool]             `nasa:"enable/beta/api"`
	RolloutPercent   nasa.UFO[int]              `nasa:"rollout/percent"`
	ExperimentConfig nasa.UFO[ExperimentConfig] `nasa:"experiment/config"`
}

type LimitsConfig struct {
	MaxRequestsPerSecond nasa.UFO[int] `nasa:"max/rps"`
	MaxConcurrentUsers   nasa.UFO[int] `nasa:"max/concurrent/users"`
	TimeoutSeconds       nasa.UFO[int] `nasa:"timeout/seconds"`
}

type ExperimentConfig struct {
	VariantAWeight float64 `json:"variant_a_weight"`
	VariantBWeight float64 `json:"variant_b_weight"`
	Enabled        bool    `json:"enabled"`
}

func main() {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		slog.Error("failed to open db", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := setupDB(db); err != nil {
		slog.Error("failed to setup db", "error", err)
		os.Exit(1)
	}

	// No nasa.New calls: nil fields are allocated by BuildRegistry and
	// filled from the DB by poller.Start (missing keys keep the zero value).
	cfg := &AppConfig{}

	registry, err := nasa.BuildRegistry(cfg, "app")
	if err != nil {
		slog.Error("failed to build registry", "error", err)
		os.Exit(1)
	}

	poller, err := nasa.NewPoller(db, time.Second, registry)
	if err != nil {
		slog.Error("failed to build poller", "error", err)
		os.Exit(1)
	}

	ctx := context.Background()
	if err := poller.Start(ctx); err != nil {
		slog.Error("failed to start poller", "error", err)
		os.Exit(1)
	}

	slog.Info("initial config loaded",
		"enable_new_ui", cfg.Features.EnableNewUI.Get(),
		"max_rps", cfg.Limits.MaxRequestsPerSecond.Get(),
	)

	// Simulate an operator flip; the next tick picks it up.
	time.Sleep(500 * time.Millisecond)
	if _, err := db.Exec(`UPDATE t_nasa SET value='false' WHERE key='app/features/enable/new/ui'`); err != nil {
		slog.Error("failed to flip flag", "error", err)
		os.Exit(1)
	}
	time.Sleep(2 * time.Second)

	slog.Info("config after poll",
		"enable_new_ui", cfg.Features.EnableNewUI.Get(),
		"max_rps", cfg.Limits.MaxRequestsPerSecond.Get(),
	)
}

func setupDB(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE t_nasa (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		INSERT INTO t_nasa (key, value) VALUES
		('app/features/enable/new/ui', 'true'),
		('app/features/enable/beta/api', 'false'),
		('app/features/rollout/percent', '50'),
		('app/features/experiment/config', '{"variant_a_weight":0.7,"variant_b_weight":0.3,"enabled":true}'),
		('app/limits/max/rps', '200'),
		('app/limits/max/concurrent/users', '5000'),
		('app/limits/timeout/seconds', '60')
	`)
	return err
}
