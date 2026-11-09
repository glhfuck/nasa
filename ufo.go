package nasa

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"sync/atomic"
	"time"
)

// updatable is the internal contract for registered values: live writes
// and reads for the poller and Registry, plus static metadata captured
// once at Build. Unexported methods seal it — no outside package can
// implement it, so only UFO[T] ever satisfies it.
type updatable interface {
	isInitialized() bool
	update(rawData []byte) error
	reset()
	validate(rawData []byte) error
	staticType() reflect.Type
	defaultRaw() string
}

// ufoInitializer allocates zero-value UFO storage during BuildRegistry.
type ufoInitializer interface {
	init()
}

// UFO (Updatable Field Object) is a thread-safe, dynamically updated config value.
// Declare struct fields as UFO[T], not *UFO[T]: copies share one atomic slot,
// so passing by value is safe and go vet stays quiet.
type UFO[T any] struct {
	slot *ufoSlot[T]
}

type ufoSlot[T any] struct {
	val atomic.Pointer[T]
	def T
}

// init allocates the atomic slot of a zero UFO. Called by BuildRegistry
// for zero-value fields, so New stays optional.
func (u *UFO[T]) init() {
	if u.slot == nil {
		s := &ufoSlot[T]{}
		s.val.Store(&s.def)
		u.slot = s
	}
}

// isInitialized reports whether the slot exists (BuildRegistry always
// initializes; a hand-built zero value reads as zero T but can't be written).
func (u UFO[T]) isInitialized() bool {
	return u.slot != nil
}

// New allocates a UFO with an initial value.
// Calling New is optional: BuildRegistry automatically initializes zero-value
// UFO fields to their zero values.
func New[T any](initial T) UFO[T] {
	s := &ufoSlot[T]{def: initial}
	s.val.Store(&s.def)
	return UFO[T]{slot: s}
}

// Get returns the latest polled value (or the initial value if not overridden in DB).
// Maps and slices inside alias live memory: read them, never mutate.
func (u UFO[T]) Get() T {
	if u.slot == nil {
		return *new(T)
	}
	return *u.slot.val.Load()
}

// staticType reports T's reflect type without reading any value.
func (u UFO[T]) staticType() reflect.Type {
	return reflect.TypeFor[T]()
}

func (u UFO[T]) update(rawData []byte) error {
	v, err := decode[T](rawData)
	if err != nil {
		return err
	}
	u.slot.val.Store(&v)
	return nil
}

// reset restores the initial default value when the key is absent from the DB.
func (u UFO[T]) reset() {
	if u.slot != nil {
		u.slot.val.Store(&u.slot.def)
	}
}

func (u UFO[T]) validate(rawData []byte) error {
	_, err := decode[T](rawData)
	return err
}

// defaultRaw returns the JSON representation of the UFO's initial value
// for UI display and editor templates on code-only (yellow) keys.
func (u UFO[T]) defaultRaw() string {
	var def T
	if u.slot != nil {
		def = u.slot.def
	}
	return encodeDefault(def)
}

func encodeDefault(v any) string {
	switch d := v.(type) {
	case time.Duration:
		b, _ := json.Marshal(d.String())
		return string(b)
	case *time.Duration:
		if d == nil {
			return "null"
		}
		b, _ := json.Marshal(d.String())
		return string(b)
	}
	rv := reflect.ValueOf(v)
	if rv.IsValid() {
		switch rv.Kind() {
		case reflect.Slice:
			if rv.IsNil() {
				return "[]"
			}
		case reflect.Map:
			if rv.IsNil() {
				return "{}"
			}
		}
	}
	b, err := json.Marshal(v)
	if err != nil {
		return "null"
	}
	return string(b)
}

func decode[T any](rawData []byte) (T, error) {
	var v T
	switch target := any(&v).(type) {
	case *time.Duration:
		d, err := decodeDuration(rawData)
		if err != nil {
			return v, err
		}
		*target = d
		return v, nil
	case **time.Duration:
		if isNullJSON(rawData) {
			return v, nil
		}
		d, err := decodeDuration(rawData)
		if err != nil {
			return v, err
		}
		*target = &d
		return v, nil
	}

	if err := json.Unmarshal(rawData, &v); err != nil {
		return v, err
	}
	// null is a value only for nullable kinds (pointers, maps, slices…).
	// For the rest it is a type error: without this, Unmarshal succeeds
	// as a no-op and update would silently reset to the zero value
	// instead of keeping the old one (and the UI would stay green).
	if isNullJSON(rawData) && !isNullable(reflect.TypeFor[T]()) {
		return v, fmt.Errorf("nasa: null is not a valid %s", reflect.TypeFor[T]())
	}
	return v, nil
}

func decodeDuration(rawData []byte) (time.Duration, error) {
	if isNullJSON(rawData) {
		return 0, fmt.Errorf("nasa: null is not a valid time.Duration")
	}
	var s string
	if err := json.Unmarshal(rawData, &s); err != nil {
		return 0, fmt.Errorf("nasa: duration must be a JSON string (e.g. \"5s\"): %w", err)
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0, fmt.Errorf("nasa: invalid duration %q: %w", s, err)
	}
	return d, nil
}

// isNullJSON reports whether the raw text is a JSON null (ignoring the
// whitespace encoding/json itself tolerates around values).
func isNullJSON(raw []byte) bool {
	return string(bytes.TrimSpace(raw)) == "null"
}

// isNullable reports whether T can hold a JSON null meaningfully.
func isNullable(t reflect.Type) bool {
	switch t.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface,
		reflect.Map, reflect.Pointer, reflect.Slice, reflect.UnsafePointer:
		return true
	}
	return false
}
