package nasa

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

type Level3Config struct {
	Value UFO[string] `nasa:"value"`
}

type Level2Config struct {
	Level3 Level3Config `nasa:"level3"`
	Value  UFO[int]     `nasa:"value"`
}

type Level1Config struct {
	Level2 Level2Config `nasa:"level2"`
	Value  UFO[bool]    `nasa:"value"`
}

type RootConfig struct {
	Level1 Level1Config `nasa:"level1"`
	Value  UFO[float64] `nasa:"value"`
}

func TestNestedStructs(t *testing.T) {
	cfg := &RootConfig{
		Level1: Level1Config{
			Level2: Level2Config{
				Level3: Level3Config{
					Value: New("level3_value"),
				},
				Value: New(42),
			},
			Value: New(true),
		},
		Value: New(3.14),
	}

	reg, err := BuildRegistry(cfg, "app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedKeys := map[string]bool{
		"app/level1/value":               true,
		"app/level1/level2/value":        true,
		"app/level1/level2/level3/value": true,
		"app/value":                      true,
	}

	if len(reg.items) != len(expectedKeys) {
		t.Fatalf("got len %d, want %d", len(reg.items), len(expectedKeys))
	}

	for key := range expectedKeys {
		if !hasKey(reg, key) {
			t.Fatalf("expected key %q to be registered", key)
		}
	}
}

func TestTwoLevels(t *testing.T) {
	type Inner struct {
		Flag UFO[bool] `nasa:"flag"`
	}
	type Outer struct {
		Inner Inner    `nasa:"inner"`
		Count UFO[int] `nasa:"count"`
	}

	cfg := &Outer{
		Inner: Inner{Flag: New(false)},
		Count: New(10),
	}

	reg, err := BuildRegistry(cfg, "test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(reg.items) != 2 {
		t.Fatalf("got len %d, want 2", len(reg.items))
	}
	if !hasKey(reg, "test/inner/flag") {
		t.Fatal("expected key test/inner/flag to be registered")
	}
	if !hasKey(reg, "test/count") {
		t.Fatal("expected key test/count to be registered")
	}
}

func TestEmptyPrefix(t *testing.T) {
	type Cfg struct {
		Val UFO[string] `nasa:"my/key"`
	}
	cfg := &Cfg{Val: New("test")}

	reg, err := BuildRegistry(cfg, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !hasKey(reg, "my/key") {
		t.Fatal("expected key my/key to be registered")
	}
}

func TestNilPointerAutoInitialized(t *testing.T) {
	type Cfg struct {
		Val UFO[string] `nasa:"key"`
	}
	cfg := &Cfg{} // no New calls: zero value must just work

	reg, err := BuildRegistry(cfg, "prefix")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !hasKey(reg, "prefix/key") {
		t.Fatal("expected key prefix/key to be registered")
	}
	if !cfg.Val.isInitialized() {
		t.Fatal("nil field must be allocated")
	}
	if cfg.Val.Get() != "" {
		t.Fatalf("missing value defaults to zero V: got %q, want %q", cfg.Val.Get(), "")
	}
	if err := reg.items["prefix/key"].validate([]byte(`"hi"`)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Val.Get() != "" {
		t.Fatalf("Validate must not write: got %q, want %q", cfg.Val.Get(), "")
	}
	if err := reg.items["prefix/key"].validate([]byte(`42`)); err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestNilStructPointerAutoInitialized(t *testing.T) {
	type Inner struct {
		Flag UFO[bool] `nasa:"flag"`
	}
	type Outer struct {
		Inner *Inner `nasa:"inner"`
	}
	cfg := &Outer{} // whole subtree nil

	reg, err := BuildRegistry(cfg, "test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !hasKey(reg, "test/inner/flag") {
		t.Fatal("expected key test/inner/flag to be registered")
	}
	if cfg.Inner == nil {
		t.Fatal("nil field must be allocated")
	}
	if !cfg.Inner.Flag.isInitialized() {
		t.Fatal("nil field must be allocated")
	}
}

func TestUFOFieldRegistered(t *testing.T) {
	type Cfg struct {
		Val UFO[string] `nasa:"key"`
	}
	cfg := &Cfg{}

	reg, err := BuildRegistry(cfg, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !hasKey(reg, "key") {
		t.Fatal("expected key key to be registered")
	}
	if err := reg.items["key"].validate([]byte(`"v"`)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Val.Get() != "" {
		t.Fatalf("Validate must not write: got %q, want %q", cfg.Val.Get(), "")
	}
}

func TestNonStructPtr(t *testing.T) {
	_, err := BuildRegistry("not a struct", "prefix")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestSkipsUnexportedFields(t *testing.T) {
	type Cfg struct {
		Exported   UFO[int] `nasa:"exported"`
		unexported UFO[int] `nasa:"unexported"`
		//lint:ignore U1000 never read: the point is a nil unexported field
		unSet UFO[int] `nasa:"unset"`
	}
	// Unexported fields are always skipped, set or not.
	cfg := &Cfg{Exported: New(1), unexported: New(2)}

	reg, err := BuildRegistry(cfg, "p")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(reg.items) != 1 {
		t.Fatalf("got len %d, want 1", len(reg.items))
	}
	if !hasKey(reg, "p/exported") {
		t.Fatal("expected key p/exported to be registered")
	}
	if hasKey(reg, "p/unexported") {
		t.Fatal("expected key p/unexported to be skipped")
	}
	if hasKey(reg, "p/unset") {
		t.Fatal("expected key p/unset to be skipped")
	}
}

func TestSkipsNonDynFields(t *testing.T) {
	type Cfg struct {
		Tracked   UFO[int] `nasa:"tracked"`
		Untracked string
		Private   UFO[int] `nasa:"-"`
	}
	cfg := &Cfg{
		Tracked: New(1),
		Private: New(2),
	}

	reg, err := BuildRegistry(cfg, "app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(reg.items) != 1 {
		t.Fatalf("got len %d, want 1", len(reg.items))
	}
	if !hasKey(reg, "app/tracked") {
		t.Fatal("expected key app/tracked to be registered")
	}
}

func TestDuplicateKeyIsError(t *testing.T) {
	type Cfg struct {
		X UFO[int] `nasa:"same"`
		Y UFO[int] `nasa:"same"`
	}
	_, err := BuildRegistry(&Cfg{}, "p")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "p/same") {
		t.Fatalf("expected %q to contain %q", err.Error(), "p/same")
	}
}

type cycleA struct {
	B *cycleB `nasa:"b"`
}
type cycleB struct {
	A *cycleA `nasa:"a"`
}

func TestCycleIsError(t *testing.T) {
	_, err := BuildRegistry(&cycleA{}, "c")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "cycle") {
		t.Fatalf("expected %q to contain %q", err.Error(), "cycle")
	}
}

func TestSharedSubtreeTypeIsFine(t *testing.T) {
	type Shared struct {
		V UFO[int] `nasa:"v"`
	}
	type Cfg struct {
		One Shared  `nasa:"one"`
		Two *Shared `nasa:"two"`
	}
	reg, err := BuildRegistry(&Cfg{}, "p")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if reg.name != "p" {
		t.Fatalf("got %q, want %q", reg.name, "p")
	}
	if !hasKey(reg, "p/one/v") {
		t.Fatal("expected key p/one/v to be registered")
	}
	if !hasKey(reg, "p/two/v") {
		t.Fatal("expected key p/two/v to be registered")
	}
}

func TestStaticTypes(t *testing.T) {
	type Cfg struct {
		Name UFO[string] `nasa:"name"`
		N    UFO[int]    `nasa:"n"`
	}
	cfg := &Cfg{Name: New("hi"), N: New(3)}
	reg, err := BuildRegistry(cfg, "p")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	u, ok := reg.items["p/name"]
	if !ok {
		t.Fatal("expected key p/name to be registered")
	}
	if u.staticType() != reflect.TypeOf("") {
		t.Fatal("string static type mismatch")
	}
	u, ok = reg.items["p/n"]
	if !ok {
		t.Fatal("expected key p/n to be registered")
	}
	if u.staticType() != reflect.TypeOf(0) {
		t.Fatal("int static type mismatch")
	}
	if _, ok := reg.items["p/nope"]; ok {
		t.Fatal("expected key p/nope to be absent")
	}
}

// Lookalike for the seal test below: methods never called directly.
//
//lint:ignore U1000 methods only exist to resemble the Updatable shape
type customUpdatable struct{ v int }

func (c *customUpdatable) update(raw []byte) error   { return json.Unmarshal(raw, &c.v) }
func (c *customUpdatable) validate(raw []byte) error { return json.Unmarshal(raw, &struct{}{}) }

func TestCustomUpdatableIgnored(t *testing.T) {
	type Cfg struct {
		C *customUpdatable `nasa:"c"`
	}
	// Lookalikes with only update/validate no longer match the merged
	// interface and dissolve like any other non-T struct: silently skipped.
	reg, err := BuildRegistry(&Cfg{C: &customUpdatable{}}, "p")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if hasKey(reg, "p/c") {
		t.Fatal("expected key p/c to be skipped")
	}
	if len(reg.items) != 0 {
		t.Fatalf("expected empty, got %v", reg.items)
	}
}

func TestNewRegistryPanicsOnNilValue(t *testing.T) {
	assertPanics(t, func() { newRegistry("x", map[string]updatable{"k": nil}) })
	var typedNil UFO[int]
	assertPanics(t, func() { newRegistry("x", map[string]updatable{"k": typedNil}) })
}

func TestMergeRegistriesNilValueIsError(t *testing.T) {
	_, err := mergeRegistries([]Registry{newRegistry("a", map[string]updatable{"x": New(0)})})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	_, err = mergeRegistries([]Registry{{name: "b", items: map[string]updatable{"y": nil}}})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestZeroValueSet(t *testing.T) {
	// No New call: Build initializes the zero field, then it writes.
	var cfg struct {
		I UFO[int] `nasa:"i"`
	}
	if cfg.I.Get() != 0 {
		t.Fatalf("zero value reads as zero: got %d, want 0", cfg.I.Get())
	}
	reg, err := BuildRegistry(&cfg, "app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cfg.I.isInitialized() {
		t.Fatal("Build allocates the slot")
	}
	if err := reg.items["app/i"].update([]byte(`5`)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.I.Get() != 5 {
		t.Fatalf("got %d, want 5", cfg.I.Get())
	}
}

func TestZeroValueUpdate(t *testing.T) {
	var cfg struct {
		I UFO[int] `nasa:"i"`
	}
	reg, err := BuildRegistry(&cfg, "app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := reg.items["app/i"].update([]byte(`42`)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.I.Get() != 42 {
		t.Fatalf("got %d, want 42", cfg.I.Get())
	}
}

func TestTaggedNonUFOIsError(t *testing.T) {
	for _, tc := range []struct {
		name string
		cfg  any
	}{
		{"plain int", &struct {
			N int `nasa:"n"`
		}{}},
		{"pointer to UFO", &struct {
			T *UFO[int] `nasa:"t"`
		}{}},
		{"double pointer to UFO", &struct {
			T **UFO[int] `nasa:"t"`
		}{}},
		{"map", &struct {
			M map[string]int `nasa:"m"`
		}{}},
		{"slice", &struct {
			S []string `nasa:"s"`
		}{}},
		{"pointer to int", &struct {
			P *int `nasa:"p"`
		}{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := BuildRegistry(tc.cfg, "app")
			if err == nil {
				t.Fatal("tagged non-UFO field must fail fast")
			}
		})
	}
}

func TestSelfCycleFailsWithoutAllocating(t *testing.T) {
	type Self struct {
		Me *Self `nasa:"me"`
	}
	cfg := &Self{}
	_, err := BuildRegistry(cfg, "c")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if cfg.Me != nil {
		t.Fatalf("failed build must not mutate the config: got %v, want nil", cfg.Me)
	}
}

func hasKey(reg Registry, key string) bool {
	_, ok := reg.items[key]
	return ok
}

func TestDescTagRecorded(t *testing.T) {
	type Cfg struct {
		WithDesc    UFO[int]    `nasa:"with" desc:"Max RPS per node"`
		WithoutDesc UFO[string] `nasa:"without"`
	}
	reg, err := BuildRegistry(&Cfg{}, "app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if reg.descs["app/with"] != "Max RPS per node" {
		t.Fatalf("got %q, want %q", reg.descs["app/with"], "Max RPS per node")
	}
	if _, ok := reg.descs["app/without"]; ok {
		t.Fatal("descs must not contain app/without")
	}
}
