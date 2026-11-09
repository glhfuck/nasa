package sqlitetest

import (
	"context"
	"database/sql"
	"errors"
	"reflect"
	"testing"

	"github.com/glhfuck/nasa/internal/db"
	_ "modernc.org/sqlite"
)

func testDB(t *testing.T, seed string) (db.Source, *sql.DB) {
	t.Helper()
	conn, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	_, err = conn.Exec(`CREATE TABLE t_nasa (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if seed != "" {
		_, err = conn.Exec(seed)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	}
	return db.NewSQLSource(conn), conn
}

func TestFetchReturnsRows(t *testing.T) {
	src, _ := testDB(t, `INSERT INTO t_nasa (key, value) VALUES
		('a', '1'), ('b', '"x"')`)
	ctx := context.Background()

	rows, err := src.Fetch(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := map[string]string{"a": "1", "b": `"x"`}
	if !reflect.DeepEqual(rows, want) {
		t.Fatalf("got %#v, want %#v", rows, want)
	}
}

func TestPersistUpserts(t *testing.T) {
	src, conn := testDB(t, `INSERT INTO t_nasa (key, value) VALUES ('k', '100')`)
	ctx := context.Background()

	if err := src.Persist(ctx, "new", "true"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := src.Persist(ctx, "k", "101"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var stored string
	if err := conn.QueryRow(`SELECT value FROM t_nasa WHERE key='new'`).Scan(&stored); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stored != "true" {
		t.Fatalf("got %q, want %q", stored, "true")
	}
	if err := conn.QueryRow(`SELECT value FROM t_nasa WHERE key='k'`).Scan(&stored); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stored != "101" {
		t.Fatalf("got %q, want %q", stored, "101")
	}
}

func TestDeleteRemovesRow(t *testing.T) {
	src, conn := testDB(t, `INSERT INTO t_nasa (key, value) VALUES ('k', '1')`)
	ctx := context.Background()

	if err := src.Delete(ctx, "k"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var n int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM t_nasa WHERE key='k'`).Scan(&n); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if n != 0 {
		t.Fatalf("got %d, want 0", n)
	}

	err := src.Delete(ctx, "missing")
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("got error %v, want %v", err, sql.ErrNoRows)
	}
}

func TestSQLErrorsSurface(t *testing.T) {
	ctx := context.Background()

	// Missing table: every operation fails instead of returning empties.
	conn, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	src := db.NewSQLSource(conn)
	_, err = src.Fetch(ctx)
	if err == nil {
		t.Fatal("fetch on missing table must fail")
	}
	if err := src.Persist(ctx, "k", "1"); err == nil {
		t.Fatal("persist on missing table must fail")
	}
	if err := src.Delete(ctx, "k"); err == nil {
		t.Fatal("delete on missing table must fail")
	}

	// Closed DB: same, after a working start.
	src2, conn2 := testDB(t, `INSERT INTO t_nasa (key, value) VALUES ('k', '1')`)
	if err := conn2.Close(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, err := src2.Fetch(ctx); err == nil {
		t.Fatal("fetch on closed DB must fail")
	}
	if err := src2.Persist(ctx, "k", "2"); err == nil {
		t.Fatal("persist on closed DB must fail")
	}
	if err := src2.Delete(ctx, "k"); err == nil {
		t.Fatal("delete on closed DB must fail")
	}
}

func TestFetchSkipsNullValues(t *testing.T) {
	ctx := context.Background()
	conn, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	// No NOT NULL constraint here: a NULL must scan-fail and be skipped,
	// not abort the whole fetch.
	_, err = conn.Exec(`CREATE TABLE t_nasa (key TEXT PRIMARY KEY, value TEXT)`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	_, err = conn.Exec(`INSERT INTO t_nasa (key, value) VALUES ('ok', '1'), ('bad', NULL)`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	rows, err := db.NewSQLSource(conn).Fetch(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := map[string]string{"ok": "1"}
	if !reflect.DeepEqual(rows, want) {
		t.Fatalf("got %#v, want %#v", rows, want)
	}
}
