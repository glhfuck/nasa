package nasa

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/glhfuck/nasa/internal/db"
)

func testRegistry(items map[string]updatable) Registry {
	return newRegistry("test", items)
}

func TestPollerStoresRawDBValues(t *testing.T) {
	src := &fakeSource{values: map[string]string{
		"app/max/rps":     "200",
		"app/sample/size": "1000",
		"conn/only/key":   `"orphan"`,
	}}
	items := map[string]updatable{
		"app/max/rps":     New(100),
		"app/sample/size": New(500),
	}
	poller, err := newPollerWithSource(src, 0, testRegistry(items))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := poller.Start(t.Context()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	raw, err := poller.source.Fetch(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if raw["app/max/rps"] != "200" {
		t.Fatalf("got %q, want %q", raw["app/max/rps"], "200")
	}
	if raw["app/sample/size"] != "1000" {
		t.Fatalf("got %q, want %q", raw["app/sample/size"], "1000")
	}
	if raw["conn/only/key"] != `"orphan"` {
		t.Fatalf("got %q, want %q", raw["conn/only/key"], `"orphan"`)
	}
	if got := items["app/sample/size"].(UFO[int]).Get(); got != 1000 {
		t.Fatalf("got %d, want 1000", got)
	}
	if got := items["app/max/rps"].(UFO[int]).Get(); got != 200 {
		t.Fatalf("got %d, want 200", got)
	}
}

func TestPollerPollDropsDeletedKeys(t *testing.T) {
	src := &fakeSource{values: map[string]string{"app/kept": "1", "app/gone": "2"}}
	items := map[string]updatable{"app/kept": New(10), "app/gone": New(20)}
	poller, err := newPollerWithSource(src, 0, testRegistry(items))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := poller.Start(t.Context()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := items["app/gone"].(UFO[int]).Get(); got != 2 {
		t.Fatalf("got %d, want 2", got)
	}

	delete(src.values, "app/gone")
	if err := poller.pollOnce(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if got := items["app/gone"].(UFO[int]).Get(); got != 20 {
		t.Fatalf("expected app/gone to revert to default 20, got %d", got)
	}
	if got := items["app/kept"].(UFO[int]).Get(); got != 1 {
		t.Fatalf("got %d, want 1", got)
	}
}

func TestPollAppliesWithoutTicker(t *testing.T) {
	src := &fakeSource{values: map[string]string{"k": "1"}}
	items := map[string]updatable{"k": New(1)}
	poller, err := newPollerWithSource(src, time.Hour, testRegistry(items)) // ticker effectively never fires
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := poller.Start(t.Context()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	src.values["k"] = "99"
	if err := poller.pollOnce(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := items["k"].(UFO[int]).Get(); got != 99 {
		t.Fatalf("got %d, want 99", got)
	}
	raw, err := poller.source.Fetch(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if raw["k"] != "99" {
		t.Fatalf("got %q, want %q", raw["k"], "99")
	}
}

type fakeSource struct {
	values   map[string]string
	fetchErr error
}

var _ db.Source = (*fakeSource)(nil)

func (s *fakeSource) Fetch(context.Context) (map[string]string, error) {
	if s.fetchErr != nil {
		return nil, s.fetchErr
	}
	out := make(map[string]string, len(s.values))
	for k, v := range s.values {
		out[k] = v
	}
	return out, nil
}
func (s *fakeSource) Persist(_ context.Context, key string, raw string) error {
	if s.values == nil {
		s.values = make(map[string]string)
	}
	s.values[key] = raw
	return nil
}
func (s *fakeSource) Delete(_ context.Context, key string) error {
	if _, ok := s.values[key]; !ok {
		return sql.ErrNoRows
	}
	delete(s.values, key)
	return nil
}

func TestPollerKeepsStateOnFetchError(t *testing.T) {
	src := &fakeSource{values: map[string]string{"k": "1"}}
	items := map[string]updatable{"k": New(0)}
	poller, err := newPollerWithSource(src, 0, testRegistry(items))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := poller.Start(t.Context()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	src.fetchErr = errors.New("conn down")
	if err := poller.pollOnce(context.Background()); err == nil {
		t.Fatal("fetch error must surface")
	}
	if got := items["k"].(UFO[int]).Get(); got != 1 {
		t.Fatalf("got %d, want 1", got)
	}
}

func TestPollerStartFailsOnInitialFetchError(t *testing.T) {
	src := &fakeSource{fetchErr: errors.New("conn down")}
	items := map[string]updatable{"k": New(7)}
	poller, err := newPollerWithSource(src, 0, testRegistry(items))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := poller.Start(t.Context()); err == nil {
		t.Fatal("expected Start to fail when initial Fetch returns an error")
	}
	if got := items["k"].(UFO[int]).Get(); got != 7 {
		t.Fatalf("failed Start must keep default value: got %d, want 7", got)
	}
}

func TestPollerWorksWithoutDB(t *testing.T) {
	src := &fakeSource{values: map[string]string{"k": "1"}}
	items := map[string]updatable{"k": New(0)}
	poller, err := newPollerWithSource(src, 0, testRegistry(items))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := poller.Start(t.Context()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := items["k"].(UFO[int]).Get(); got != 1 {
		t.Fatalf("got %d, want 1", got)
	}

	src.values["k"] = "2"
	if err := poller.pollOnce(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := items["k"].(UFO[int]).Get(); got != 2 {
		t.Fatalf("got %d, want 2", got)
	}
}

func TestNewMergesDisjointRegistries(t *testing.T) {
	src := &fakeSource{values: map[string]string{"a": "1", "b": "2"}}
	aVal := New(0)
	bVal := New(0)
	a := testRegistry(map[string]updatable{"a": aVal})
	b := testRegistry(map[string]updatable{"b": bVal})
	poller, err := newPollerWithSource(src, time.Second, a, b)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := poller.Start(t.Context()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if aVal.Get() != 1 {
		t.Fatalf("got %d, want 1", aVal.Get())
	}
	if bVal.Get() != 2 {
		t.Fatalf("got %d, want 2", bVal.Get())
	}
}

func TestNewDuplicateKeyIsError(t *testing.T) {
	a := newRegistry("a", map[string]updatable{"x": New(0)})
	b := newRegistry("b", map[string]updatable{"x": New(1)})
	_, err := NewPoller(&sql.DB{}, time.Second, a, b)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	for _, sub := range []string{`"x"`, `"a"`, `"b"`} {
		if !strings.Contains(err.Error(), sub) {
			t.Fatalf("expected %q to contain %q", err.Error(), sub)
		}
	}
}

func TestNewNonPositiveIntervalDefaultsToMinute(t *testing.T) {
	poller, err := newPollerWithSource(&fakeSource{}, 0, testRegistry(nil))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if poller.interval != time.Minute {
		t.Fatalf("got %v, want %v", poller.interval, time.Minute)
	}
}

func TestPollRevertsDeletedKeysWithoutResurrectingInDB(t *testing.T) {
	type Cfg struct {
		K    UFO[int]    `nasa:"k"`
		Zero UFO[string] `nasa:"zero"`
	}
	cfg := &Cfg{K: New(5)}
	reg, err := BuildRegistry(cfg, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	src := &fakeSource{values: map[string]string{"k": "1", "zero": `"override"`}}
	poller, err := newPollerWithSource(src, 0, reg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := poller.Start(t.Context()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.K.Get() != 1 {
		t.Fatalf("got %d, want 1", cfg.K.Get())
	}
	if cfg.Zero.Get() != "override" {
		t.Fatalf("got %q, want %q", cfg.Zero.Get(), "override")
	}

	delete(src.values, "k")
	delete(src.values, "zero")
	if err := poller.pollOnce(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Row stays deleted in DB (yellow in the UI), and memory reverts to defaults.
	if len(src.values) != 0 {
		t.Fatalf("expected empty, got %v", src.values)
	}
	if cfg.K.Get() != 5 {
		t.Fatalf("deleted key must revert to New initial value: got %d, want 5", cfg.K.Get())
	}
	if cfg.Zero.Get() != "" {
		t.Fatalf("deleted zero-initialized key must revert to zero T: got %q, want %q", cfg.Zero.Get(), "")
	}
}
func TestNewPanicsOnNilDB(t *testing.T) {
	reg, err := BuildRegistry(&struct {
		K UFO[int] `nasa:"k"`
	}{}, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	assertPanics(t, func() { _, _ = NewPoller(nil, time.Second, reg) })
}

func TestPollerKeepsOldValueOnBadJSON(t *testing.T) {
	src := &fakeSource{values: map[string]string{"k": "1"}}
	cfg := &struct {
		K UFO[int] `nasa:"k"`
	}{K: New(1)}
	reg, err := BuildRegistry(cfg, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	poller, err := newPollerWithSource(src, 0, reg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := poller.Start(t.Context()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.K.Get() != 1 {
		t.Fatalf("got %d, want 1", cfg.K.Get())
	}

	// Garbage and type-mismatched values must not touch memory.
	for _, bad := range []string{`not json at all`, `"oops"`, `1.5`, `null`} {
		src.values["k"] = bad
		if err := poller.pollOnce(context.Background()); err != nil {
			t.Fatalf("per-key failure must not fail the tick: %v", err)
		}
		if cfg.K.Get() != 1 {
			t.Fatalf("bad value %q must keep old: got %d, want 1", bad, cfg.K.Get())
		}
	}
}
