package nasa

import (
	"reflect"
	"sort"
	"testing"
	"time"
)

// assertPanics fails the test when fn does not panic.
func assertPanics(t *testing.T, fn func()) {
	t.Helper()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic, but function did not panic")
		}
	}()
	fn()
}

// The public UFO surface is exactly Get on both the value and the
// pointer: any exported method added here would silently widen the API.
func TestUFOPublicSurface(t *testing.T) {
	for _, typ := range []reflect.Type{reflect.TypeFor[UFO[int]](), reflect.TypeFor[*UFO[int]]()} {
		var names []string
		for i := 0; i < typ.NumMethod(); i++ {
			names = append(names, typ.Method(i).Name)
		}
		sort.Strings(names)
		if !reflect.DeepEqual(names, []string{"Get"}) {
			t.Fatalf("got %v, want [Get] (type %s)", names, typ.String())
		}
	}
}

// Registry exposes no methods at all: it is only constructed and passed.
func TestRegistryPublicSurface(t *testing.T) {
	for _, typ := range []reflect.Type{reflect.TypeFor[Registry](), reflect.TypeFor[*Registry]()} {
		if n := typ.NumMethod(); n != 0 {
			t.Fatalf("got %d methods for %s, want 0", n, typ.String())
		}
	}
}

// Poller exposes only Start.
func TestPollerPublicSurface(t *testing.T) {
	typ := reflect.TypeFor[*Poller]()
	var names []string
	for i := 0; i < typ.NumMethod(); i++ {
		names = append(names, typ.Method(i).Name)
	}
	sort.Strings(names)
	if !reflect.DeepEqual(names, []string{"Start"}) {
		t.Fatalf("got methods %v, want [Start]", names)
	}
}

func TestGetSet(t *testing.T) {
	val := New(42)
	if val.Get() != 42 {
		t.Fatalf("got %d, want 42", val.Get())
	}

	if err := val.update([]byte(`100`)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val.Get() != 100 {
		t.Fatalf("got %d, want 100", val.Get())
	}
}

func TestUpdatePrimitive(t *testing.T) {
	val := New(false)

	if err := val.update([]byte("true")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !val.Get() {
		t.Fatal("expected true, got false")
	}

	if err := val.update([]byte("false")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val.Get() {
		t.Fatal("expected false, got true")
	}
}

func TestUpdateInt(t *testing.T) {
	val := New(0)

	if err := val.update([]byte("42")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val.Get() != 42 {
		t.Fatalf("got %d, want 42", val.Get())
	}
}

func TestUpdateInt8(t *testing.T) {
	val := New(int8(0))

	if err := val.update([]byte("127")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val.Get() != int8(127) {
		t.Fatalf("got %d, want 127", val.Get())
	}
}

func TestUpdateInt64(t *testing.T) {
	val := New(int64(0))

	if err := val.update([]byte("9223372036854775807")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val.Get() != int64(9223372036854775807) {
		t.Fatalf("got %d, want 9223372036854775807", val.Get())
	}
}

func TestUpdateUint(t *testing.T) {
	val := New(uint(0))

	if err := val.update([]byte("42")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val.Get() != uint(42) {
		t.Fatalf("got %d, want 42", val.Get())
	}
}

func TestUpdateFloat64(t *testing.T) {
	val := New(float64(0))

	if err := val.update([]byte("3.14159")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val.Get() != 3.14159 {
		t.Fatalf("got %v, want 3.14159", val.Get())
	}
}

func TestUpdateString(t *testing.T) {
	val := New("initial")

	if err := val.update([]byte(`"updated"`)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val.Get() != "updated" {
		t.Fatalf("got %q, want %q", val.Get(), "updated")
	}
}

func TestUpdateStruct(t *testing.T) {
	type Config struct {
		Enabled bool
		Count   int
		Name    string
	}

	val := New(Config{Enabled: false, Count: 0, Name: "init"})

	data := []byte(`{"Enabled":true,"Count":10,"Name":"test"}`)
	if err := val.update(data); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	c := val.Get()
	if !c.Enabled {
		t.Fatal("Enabled: expected true, got false")
	}
	if c.Count != 10 {
		t.Fatalf("Count: got %d, want 10", c.Count)
	}
	if c.Name != "test" {
		t.Fatalf("Name: got %q, want %q", c.Name, "test")
	}
}

func TestUpdateNestedStruct(t *testing.T) {
	type Inner struct {
		Value int `json:"value"`
	}
	type Outer struct {
		Inner Inner  `json:"inner"`
		Name  string `json:"name"`
	}

	val := New(Outer{Inner: Inner{Value: 0}, Name: "init"})

	data := []byte(`{"inner":{"value":42},"name":"outer"}`)
	if err := val.update(data); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	c := val.Get()
	if c.Inner.Value != 42 {
		t.Fatalf("Inner.Value: got %d, want 42", c.Inner.Value)
	}
	if c.Name != "outer" {
		t.Fatalf("Name: got %q, want %q", c.Name, "outer")
	}
}

func TestUpdateSlice(t *testing.T) {
	val := New([]string{"a", "b"})

	data := []byte(`["x","y","z"]`)
	if err := val.update(data); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	result := val.Get()
	want := []string{"x", "y", "z"}
	if !reflect.DeepEqual(result, want) {
		t.Fatalf("got %#v, want %#v", result, want)
	}
}

func TestUpdateSliceOfStructs(t *testing.T) {
	type Item struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	}

	val := New([]Item{{ID: 1, Name: "a"}})

	data := []byte(`[{"id":2,"name":"b"},{"id":3,"name":"c"}]`)
	if err := val.update(data); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	result := val.Get()
	if len(result) != 2 {
		t.Fatalf("got len %d, want 2", len(result))
	}
	if result[0].ID != 2 {
		t.Fatalf("ID: got %d, want 2", result[0].ID)
	}
	if result[0].Name != "b" {
		t.Fatalf("Name: got %q, want %q", result[0].Name, "b")
	}
}

func TestUpdateMap(t *testing.T) {
	val := New(map[string]int{"a": 1})

	data := []byte(`{"b":2,"c":3}`)
	if err := val.update(data); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := val.Get()
	want := map[string]int{"b": 2, "c": 3}
	if !reflect.DeepEqual(m, want) {
		t.Fatalf("got %#v, want %#v", m, want)
	}
}

func TestUpdateMapOfStructs(t *testing.T) {
	type Item struct {
		Value int `json:"value"`
	}

	val := New(map[string]Item{"a": {Value: 1}})

	data := []byte(`{"b":{"value":2},"c":{"value":3}}`)
	if err := val.update(data); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := val.Get()
	if len(m) != 2 {
		t.Fatalf("got len %d, want 2", len(m))
	}
	if m["b"].Value != 2 {
		t.Fatalf("b.value: got %d, want 2", m["b"].Value)
	}
}

func TestUpdatePointer(t *testing.T) {
	val := New((*string)(nil))

	data := []byte(`"world"`)
	if err := val.update(data); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	p := val.Get()
	if p == nil {
		t.Fatal("expected non-nil pointer")
	}
	if *p != "world" {
		t.Fatalf("got %q, want %q", *p, "world")
	}

	// Update to nil
	if err := val.update([]byte("null")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val.Get() != nil {
		t.Fatalf("expected nil, got %v", val.Get())
	}
}

func TestUpdateTime(t *testing.T) {
	val := New(time.Time{})

	data := []byte(`"2026-09-11T12:00:00Z"`)
	if err := val.update(data); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	tm := val.Get()
	expected := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	if !tm.Equal(expected) {
		t.Fatalf("got %v, want %v", tm, expected)
	}
}

func TestUpdateDuration(t *testing.T) {
	val := New(5 * time.Second)
	if val.Get() != 5*time.Second {
		t.Fatalf("got %v, want %v", val.Get(), 5*time.Second)
	}

	if err := val.update([]byte(`"250ms"`)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val.Get() != 250*time.Millisecond {
		t.Fatalf("got %v, want %v", val.Get(), 250*time.Millisecond)
	}

	if err := val.update([]byte(`"1h30m"`)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val.Get() != 90*time.Minute {
		t.Fatalf("got %v, want %v", val.Get(), 90*time.Minute)
	}

	// Raw numbers, invalid duration strings, and null must fail and keep the old value.
	for _, bad := range []string{`1000`, `"5days"`, `"not-a-duration"`, `null`} {
		if err := val.update([]byte(bad)); err == nil {
			t.Fatalf("input %s must be rejected", bad)
		}
		if val.Get() != 90*time.Minute {
			t.Fatalf("failed update for %s must keep old value", bad)
		}
	}
}

func TestUpdateDurationPointer(t *testing.T) {
	val := New((*time.Duration)(nil))
	if val.Get() != nil {
		t.Fatalf("expected nil, got %v", val.Get())
	}

	if err := val.update([]byte(`"10s"`)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val.Get() == nil {
		t.Fatal("expected non-nil pointer")
	}
	if *val.Get() != 10*time.Second {
		t.Fatalf("got %v, want %v", *val.Get(), 10*time.Second)
	}

	if err := val.update([]byte(`null`)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val.Get() != nil {
		t.Fatalf("expected nil, got %v", val.Get())
	}

	if err := val.update([]byte(`10`)); err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestUpdateInvalidJSON(t *testing.T) {
	val := New(0)

	err := val.update([]byte("not json"))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if val.Get() != 0 {
		t.Fatalf("failed update must keep the old value: got %d, want 0", val.Get())
	}
}

func TestUpdateTypeMismatch(t *testing.T) {
	val := New(0)

	err := val.update([]byte(`"not an int"`))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if val.Get() != 0 {
		t.Fatalf("failed update must keep the old value: got %d, want 0", val.Get())
	}
}

func TestUpdateEmptyStruct(t *testing.T) {
	type Empty struct{}

	val := New(Empty{})

	data := []byte(`{}`)
	if err := val.update(data); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestUpdateArray(t *testing.T) {
	val := New([3]int{1, 2, 3})

	data := []byte(`[10,20,30]`)
	if err := val.update(data); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	arr := val.Get()
	if arr != [3]int{10, 20, 30} {
		t.Fatalf("got %v, want [10 20 30]", arr)
	}
}

func TestUpdateComplexStruct(t *testing.T) {
	type Complex struct {
		String  string         `json:"string"`
		Int     int            `json:"int"`
		Float   float64        `json:"float"`
		Bool    bool           `json:"bool"`
		Slice   []string       `json:"slice"`
		Map     map[string]int `json:"map"`
		Pointer *string        `json:"pointer"`
		Time    time.Time      `json:"time"`
		Nested  struct {
			Value int `json:"value"`
		} `json:"nested"`
	}

	val := New(Complex{})

	data := []byte(`{
		"string": "test",
		"int": 42,
		"float": 3.14,
		"bool": true,
		"slice": ["a", "b"],
		"map": {"x": 1, "y": 2},
		"pointer": "ptr_value",
		"time": "2026-09-11T12:00:00Z",
		"nested": {"value": 100}
	}`)
	if err := val.update(data); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	c := val.Get()
	if c.String != "test" {
		t.Fatalf("String: got %q, want %q", c.String, "test")
	}
	if c.Int != 42 {
		t.Fatalf("Int: got %d, want 42", c.Int)
	}
	if c.Float != 3.14 {
		t.Fatalf("Float: got %v, want 3.14", c.Float)
	}
	if !c.Bool {
		t.Fatal("Bool: expected true, got false")
	}
	if !reflect.DeepEqual(c.Slice, []string{"a", "b"}) {
		t.Fatalf("Slice: got %#v, want [a b]", c.Slice)
	}
	if !reflect.DeepEqual(c.Map, map[string]int{"x": 1, "y": 2}) {
		t.Fatalf("Map: got %#v, want [x:1 y:2]", c.Map)
	}
	if c.Pointer == nil {
		t.Fatal("Pointer: expected non-nil pointer")
	}
	if *c.Pointer != "ptr_value" {
		t.Fatalf("Pointer: got %q, want %q", *c.Pointer, "ptr_value")
	}
	expectedTime := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	if !c.Time.Equal(expectedTime) {
		t.Fatalf("Time: got %v, want %v", c.Time, expectedTime)
	}
	if c.Nested.Value != 100 {
		t.Fatalf("Nested.Value: got %d, want 100", c.Nested.Value)
	}
}

func TestValidateDoesNotMutate(t *testing.T) {
	val := New(42)
	if err := val.validate([]byte(`100`)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val.Get() != 42 {
		t.Fatalf("Validate must not change the value: got %d, want 42", val.Get())
	}
	if err := val.validate([]byte(`"not an int"`)); err == nil {
		t.Fatal("expected error, got nil")
	}
	if val.Get() != 42 {
		t.Fatalf("got %d, want 42", val.Get())
	}
}

func TestUpdatableContract(t *testing.T) {
	var _ updatable = New(0)
}

func TestStaticType(t *testing.T) {
	if New("").staticType() != reflect.TypeOf("") {
		t.Fatal("string static type mismatch")
	}
	if New(0).staticType() != reflect.TypeOf(0) {
		t.Fatal("int static type mismatch")
	}
	if New(int64(0)).staticType() != reflect.TypeOf(int64(0)) {
		t.Fatal("int64 static type mismatch")
	}
	if New(0.0).staticType() != reflect.TypeOf(0.0) {
		t.Fatal("float64 static type mismatch")
	}
	if New(false).staticType() != reflect.TypeOf(false) {
		t.Fatal("bool static type mismatch")
	}
	if New([]string{}).staticType() != reflect.TypeOf([]string{}) {
		t.Fatal("[]string static type mismatch")
	}
	if New(map[string]int{}).staticType() != reflect.TypeOf(map[string]int{}) {
		t.Fatal("map static type mismatch")
	}
	type S struct{ A int }
	if New(S{}).staticType() != reflect.TypeOf(S{}) {
		t.Fatal("struct static type mismatch")
	}
	s := "x"
	// No dereference here: staticType reports V truthfully (*string);
	// the UI maps it onto "string" for display (see ui.typeDisplayName).
	if New(&s).staticType() != reflect.TypeOf(&s) {
		t.Fatal("*string static type mismatch")
	}
	if New(time.Second).staticType() != reflect.TypeFor[time.Duration]() {
		t.Fatal("time.Duration static type mismatch")
	}
}

func TestZeroValueGet(t *testing.T) {
	var i UFO[int]
	if i.Get() != 0 {
		t.Fatalf("got %d, want 0", i.Get())
	}
	var s UFO[string]
	if s.Get() != "" {
		t.Fatalf("got %q, want %q", s.Get(), "")
	}
	var b UFO[bool]
	if b.Get() {
		t.Fatal("expected false, got true")
	}
	type S struct{ A int }
	var st UFO[S]
	if st.Get() != (S{}) {
		t.Fatalf("got %v, want zero S", st.Get())
	}
}

func TestZeroValueValidate(t *testing.T) {
	var i UFO[int]
	if err := i.validate([]byte(`1`)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := i.validate([]byte(`"x"`)); err == nil {
		t.Fatal("expected error, got nil")
	}
	if i.Get() != 0 {
		t.Fatalf("Validate must not change the value: got %d, want 0", i.Get())
	}
}

func TestResetRestoresDefault(t *testing.T) {
	val := New(42)
	if err := val.update([]byte(`100`)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val.Get() != 100 {
		t.Fatalf("got %d, want 100", val.Get())
	}

	val.reset()
	if val.Get() != 42 {
		t.Fatalf("reset must restore the initial value passed to New: got %d, want 42", val.Get())
	}

	var zero UFO[int]
	zero.init()
	if err := zero.update([]byte(`77`)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if zero.Get() != 77 {
		t.Fatalf("got %d, want 77", zero.Get())
	}

	zero.reset()
	if zero.Get() != 0 {
		t.Fatalf("reset on auto-initialized UFO must restore zero T: got %d, want 0", zero.Get())
	}
}

func TestDefaultRaw(t *testing.T) {
	if New(42).defaultRaw() != "42" {
		t.Fatalf("got %q, want %q", New(42).defaultRaw(), "42")
	}
	if New(5*time.Second).defaultRaw() != `"5s"` {
		t.Fatalf("got %q, want %q", New(5*time.Second).defaultRaw(), `"5s"`)
	}
	if New(time.Duration(0)).defaultRaw() != `"0s"` {
		t.Fatalf("got %q, want %q", New(time.Duration(0)).defaultRaw(), `"0s"`)
	}

	var nilDurPtr UFO[*time.Duration]
	nilDurPtr.init()
	if nilDurPtr.defaultRaw() != "null" {
		t.Fatalf("got %q, want %q", nilDurPtr.defaultRaw(), "null")
	}
	d := 1500 * time.Millisecond
	if New(&d).defaultRaw() != `"1.5s"` {
		t.Fatalf("got %q, want %q", New(&d).defaultRaw(), `"1.5s"`)
	}

	var sl UFO[[]string]
	sl.init()
	if sl.defaultRaw() != "[]" {
		t.Fatalf("got %q, want %q", sl.defaultRaw(), "[]")
	}
	if New([]string{"a"}).defaultRaw() != `["a"]` {
		t.Fatalf(`got %q, want %q`, New([]string{"a"}).defaultRaw(), `["a"]`)
	}

	var m UFO[map[string]int]
	m.init()
	if m.defaultRaw() != "{}" {
		t.Fatalf("got %q, want %q", m.defaultRaw(), "{}")
	}

	type S struct {
		Host string `json:"host"`
		Port int    `json:"port"`
	}
	var st UFO[S]
	st.init()
	if st.defaultRaw() != `{"host":"","port":0}` {
		t.Fatalf("got %q, want %q", st.defaultRaw(), `{"host":"","port":0}`)
	}
	if New(S{Host: "db", Port: 5432}).defaultRaw() != `{"host":"db","port":5432}` {
		t.Fatalf(`got %q, want %q`, New(S{Host: "db", Port: 5432}).defaultRaw(), `{"host":"db","port":5432}`)
	}

	// Uninitialized zero UFO reads the zero T default.
	var bare UFO[int]
	if bare.defaultRaw() != "0" {
		t.Fatalf("got %q, want %q", bare.defaultRaw(), "0")
	}
}
