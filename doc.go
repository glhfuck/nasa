// Package nasa (Nightly And Safe Adjustments) provides typed, concurrency-safe
// dynamic configuration and feature flags for Go services, backed by PostgreSQL
// or SQLite with zero external dependencies.
//
// Configuration values live in a single SQL table (t_nasa) as JSON text and are
// polled into in-memory [UFO] fields on a timer. A built-in web control panel
// can be mounted via [ServeUI] to inspect, diff, toggle, and reset keys at
// runtime without redeploying the service.
//
// # Database Schema
//
// Create the backing table once in PostgreSQL or SQLite:
//
//	CREATE TABLE t_nasa (
//	    key   TEXT PRIMARY KEY,
//	    value TEXT NOT NULL
//	);
//
// # Core Primitives
//
//   - [UFO] (Updatable Field Object) wraps a single configuration field of type T.
//     Application code reads the current value lock-free via [UFO.Get].
//   - [Registry] indexes a Go struct's "nasa" struct tags into slash-separated
//     database keys via [BuildRegistry].
//   - [Poller] queries t_nasa periodically and atomically updates registered
//     [UFO] fields in memory.
//   - [ServeUI] mounts an optional, self-contained web dashboard under /ui.
//
// # Quick Start
//
// Define a struct with [UFO] fields, build a [Registry], and start a [Poller]:
//
//	type AppConfig struct {
//	    KillSwitch nasa.UFO[bool]          `nasa:"kill-switch" desc:"Emergency stop"`
//	    MaxRPS     nasa.UFO[int]           `nasa:"limits/max-rps" desc:"Per-node RPS cap"`
//	    Timeout    nasa.UFO[time.Duration] `nasa:"limits/timeout"`
//	}
//
//	cfg := AppConfig{
//	    MaxRPS:  nasa.New(200),
//	    Timeout: nasa.New(250 * time.Millisecond),
//	}
//
//	reg, err := nasa.BuildRegistry(&cfg, "app")
//	if err != nil {
//	    log.Fatal(err)
//	}
//
//	poller, err := nasa.NewPoller(db, 5*time.Second, reg)
//	if err != nil {
//	    log.Fatal(err)
//	}
//	if err := poller.Start(ctx); err != nil {
//	    log.Fatal(err)
//	}
//
//	// Read anywhere on the hot path:
//	if cfg.KillSwitch.Get() {
//	    return
//	}
//	rps := cfg.MaxRPS.Get()
//
// # Safety Guarantees
//
//   - Missing database rows fall back to the compiled-in default passed to [New]
//     (or the zero value of T).
//   - Deleting a row from t_nasa reverts the corresponding [UFO] to its
//     compiled-in default on the next poll tick.
//   - Malformed JSON or type mismatches in t_nasa are logged and ignored,
//     preserving the last valid in-memory value.
//   - Transient database errors on background ticks leave in-memory values
//     untouched until the database recovers.
package nasa
