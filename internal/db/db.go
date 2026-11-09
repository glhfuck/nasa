// Package db hides the SQL side of dynamic config. It lives in internal/
// so it never surfaces in the public API: users see only nasa.NewPoller
// and nasa.ServeUI, while the packages inside share this implementation.
package db

import (
	"context"
	"database/sql"
	"log/slog"
)

const (
	tNasa  = "t_nasa"
	cKey   = "key"
	cValue = "value"
)

// $N placeholders work in both PostgreSQL and SQLite.
const (
	qFetch  = `SELECT ` + cKey + `, ` + cValue + ` FROM ` + tNasa
	qDelete = `DELETE FROM ` + tNasa + ` WHERE ` + cKey + ` = $1`
	qUpsert = `INSERT INTO ` + tNasa + `(` + cKey + `, ` + cValue + `) VALUES($1, $2)` +
		` ON CONFLICT(` + cKey + `) DO UPDATE SET ` + cValue + ` = excluded.` + cValue
)

// Source is the database side of dynamic config: raw rows in and out.
// The Poller owns memory state and polling cadence; Source owns SQL and
// knows nothing about registries or polling.
type Source interface {
	Fetch(ctx context.Context) (map[string]string, error)
	Persist(ctx context.Context, key string, rawValue string) error
	// Delete removes the row and returns sql.ErrNoRows when absent.
	Delete(ctx context.Context, key string) error
}

type sqlSource struct {
	db *sql.DB
}

// NewSQLSource adapts a *sql.DB to Source.
func NewSQLSource(db *sql.DB) Source {
	return &sqlSource{db: db}
}

func (s *sqlSource) Fetch(ctx context.Context) (map[string]string, error) {
	rows, err := s.db.QueryContext(ctx, qFetch)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := make(map[string]string)
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			slog.Error("failed to scan config row", "error", err)
			continue
		}
		values[key] = value
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return values, nil
}

func (s *sqlSource) Persist(ctx context.Context, key string, rawValue string) error {
	_, err := s.db.ExecContext(ctx, qUpsert, key, rawValue)
	return err
}

func (s *sqlSource) Delete(ctx context.Context, key string) error {
	res, err := s.db.ExecContext(ctx, qDelete, key)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}
