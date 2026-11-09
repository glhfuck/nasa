package ui

import (
	"encoding/json"
	"reflect"
	"strings"
	"time"
)

func inferTypeInfo(v any) string {
	// Inputs are always JSON-decoded (gray path), so values are never
	// Go pointers — only nil needs special-casing, the rest is static.
	if v == nil {
		return "null"
	}
	// decodeRaw uses UseNumber: big integers arrive as json.Number
	// (exact text), not lossy float64. Classify by syntax.
	if n, ok := v.(json.Number); ok {
		if isIntSyntax(n.String()) {
			return "int"
		}
		return "float"
	}
	return typeDisplayName(reflect.TypeOf(v))
}

// isIntSyntax reports whether s is a JSON integer literal (no fraction
// or exponent part): 42, -7 — but not 4.2 or 1e3.
func isIntSyntax(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= '0' && c <= '9' {
			continue
		}
		if i == 0 && (c == '-' || c == '+') {
			continue
		}
		return false
	}
	return true
}

var durationType = reflect.TypeFor[time.Duration]()

// Kept separate from inferTypeInfo on purpose: that one classifies runtime
// values (nil value → null), this one classifies the declared type
// (a *string config IS a string config, even when empty).
func typeDisplayName(t reflect.Type) string {
	if t == durationType {
		return "duration"
	}
	switch t.Kind() {
	case reflect.String:
		return "string"
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return "int"
	case reflect.Float32, reflect.Float64:
		return "float"
	case reflect.Bool:
		return "bool"
	case reflect.Slice, reflect.Array:
		return "array"
	case reflect.Map:
		return "object"
	case reflect.Struct:
		return "object"
	case reflect.Pointer:
		return typeDisplayName(t.Elem())
	default:
		return "unknown"
	}
}

// Non-JSON text counts as a plain string: operator-typed values like
// bare words never hard-fail the list, they surface as strings.
// Numbers decode with UseNumber so int64 survives the trip exactly
// (float64 would print 9223372036854775807 as 9.22e18).
// Callers needing strictness should Validate instead.
func decodeRaw(raw string) any {
	var v any
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&v); err != nil {
		return raw
	}
	return v
}
