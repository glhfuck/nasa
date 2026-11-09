package ui

import (
	"reflect"
	"testing"
	"time"
)

func TestMetaOfType(t *testing.T) {
	cases := []struct {
		name  string
		value any
		want  string
	}{
		{"string", "", "string"},
		{"int", 0, "int"},
		{"int8", int8(0), "int"},
		{"int64", int64(0), "int"},
		{"uint", uint(0), "int"},
		{"float", 0.5, "float"},
		{"float32", float32(0), "float"},
		{"bool", true, "bool"},
		{"slice", []string{}, "array"},
		{"map", map[string]any{}, "object"},
		{"struct", struct{}{}, "object"},
		{"pointer unwraps", new(string), "string"},
		{"duration", time.Duration(0), "duration"},
		{"duration pointer", new(time.Duration), "duration"},
		{"chan is unknown", make(chan int), "unknown"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := typeDisplayName(reflect.TypeOf(c.value)); got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestInferTypeInfo(t *testing.T) {
	if got := inferTypeInfo(nil); got != "null" {
		t.Fatalf("got %q, want %q", got, "null")
	}
	if got := inferTypeInfo(decodeRaw(`42`)); got != "int" {
		t.Fatalf("got %q, want %q", got, "int")
	}
	if got := inferTypeInfo(decodeRaw(`9223372036854775807`)); got != "int" {
		t.Fatalf("got %q, want %q", got, "int")
	}
	if got := inferTypeInfo(decodeRaw(`4.2`)); got != "float" {
		t.Fatalf("got %q, want %q", got, "float")
	}
	if got := inferTypeInfo(decodeRaw(`"x"`)); got != "string" {
		t.Fatalf("got %q, want %q", got, "string")
	}
	if got := inferTypeInfo(decodeRaw(`[1]`)); got != "array" {
		t.Fatalf("got %q, want %q", got, "array")
	}
	if got := inferTypeInfo(decodeRaw(`{"a":1}`)); got != "object" {
		t.Fatalf("got %q, want %q", got, "object")
	}
	if got := inferTypeInfo(decodeRaw(`true`)); got != "bool" {
		t.Fatalf("got %q, want %q", got, "bool")
	}
	// Bare words are not JSON: they surface as plain strings, never errors.
	if got := decodeRaw(`oops`); got != "oops" {
		t.Fatalf("got %q, want %q", got, "oops")
	}
	if got := inferTypeInfo(decodeRaw(`oops`)); got != "string" {
		t.Fatalf("got %q, want %q", got, "string")
	}
}
