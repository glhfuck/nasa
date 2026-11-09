package nasa

import (
	"context"
	"database/sql"
	"log/slog"
	"time"

	"github.com/glhfuck/nasa/internal/db"
)

// Poller periodically synchronizes registered config structs with the database.
type Poller struct {
	source   db.Source
	merged   map[string]updatable
	interval time.Duration
}

// NewPoller creates a Poller for the given registries.
// Returns an error if two registries share a key. If interval <= 0, it defaults to 1 minute.
func NewPoller(database *sql.DB, interval time.Duration, registries ...Registry) (*Poller, error) {
	if database == nil {
		panic("nasa: NewPoller requires a non-nil *sql.DB")
	}
	return newPollerWithSource(db.NewSQLSource(database), interval, registries...)
}

// newPollerWithSource builds a Poller over a custom source (a fake in tests).
func newPollerWithSource(source db.Source, interval time.Duration, registries ...Registry) (*Poller, error) {
	if interval <= 0 {
		interval = time.Minute
	}
	merged, err := mergeRegistries(registries)
	if err != nil {
		return nil, err
	}
	return &Poller{
		source:   source,
		merged:   merged,
		interval: interval,
	}, nil
}

// Start performs an initial synchronous fetch and launches a background
// goroutine that polls on every tick until ctx is canceled.
// Per-key decode errors are logged and keep their previous value; only a
// query failure returns an error. If the initial fetch fails, Start returns
// the error without starting the background goroutine.
func (p *Poller) Start(ctx context.Context) error {
	if err := p.pollOnce(ctx); err != nil {
		return err
	}

	go func() {
		ticker := time.NewTicker(p.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := p.pollOnce(ctx); err != nil {
					slog.Error("failed to query dynamic config", "error", err)
				}
			}
		}
	}()

	return nil
}

func (p *Poller) pollOnce(ctx context.Context) error {
	values, err := p.source.Fetch(ctx)
	if err != nil {
		return err
	}
	apply(p.merged, values)
	return nil
}
