package nasa

import (
	"errors"
	"fmt"
	"log/slog"
	"reflect"
	"slices"
)

var ErrNotStructPtr = errors.New("nasa: config must be a pointer to a struct")

// Registry is an opaque handle to a named group of config fields built by BuildRegistry.
type Registry struct {
	name  string
	items map[string]updatable
	descs map[string]string
}

// BuildRegistry indexes cfg's nasa-tagged fields under name ("experiment"
// → keys experiment/*). It allocates nil struct-pointer chains and
// uninitialized UFO fields, so New is optional. Untagged, "-" and unexported fields are
// skipped; any other tagged field type returns an error. The registry
// aliases your struct — don't share cfg concurrently during the build.
func BuildRegistry(cfg any, name string) (Registry, error) {
	v := reflect.ValueOf(cfg)
	if v.Kind() != reflect.Pointer || v.IsNil() || v.Elem().Kind() != reflect.Struct {
		return Registry{}, ErrNotStructPtr
	}

	reg := Registry{
		name:  name,
		items: make(map[string]updatable),
		descs: make(map[string]string),
	}
	if err := reg.buildRecursive(v.Elem(), name, []reflect.Type{v.Type()}); err != nil {
		return Registry{}, err
	}
	return reg, nil
}

// register records one key and its optional description. Only UFO[V] values can reach it.
func (b *Registry) register(key string, value updatable, desc string) {
	b.items[key] = value
	if desc != "" {
		b.descs[key] = desc
	}
}

func (b *Registry) buildRecursive(v reflect.Value, prefix string, stack []reflect.Type) error {
	t := v.Type()
	for i := 0; i < v.NumField(); i++ {
		field := v.Field(i)
		fieldType := t.Field(i)

		tag := fieldType.Tag.Get("nasa")
		if tag == "" || tag == "-" {
			continue
		}
		if fieldType.PkgPath != "" {
			continue
		}

		key := tag
		if prefix != "" {
			key = prefix + "/" + tag
		}
		if _, dup := b.items[key]; dup {
			return fmt.Errorf("nasa: duplicate config key %q", key)
		}

		if field.Kind() == reflect.Struct {
			if field.CanAddr() {
				if init, ok := field.Addr().Interface().(ufoInitializer); ok {
					init.init()
					if u, ok := field.Interface().(updatable); ok {
						b.register(key, u, fieldType.Tag.Get("desc"))
						continue
					}
				}
			}
			// Plain nested struct: a folder in the panel.
			ptrType := reflect.PointerTo(field.Type())
			if err := checkCycle(ptrType, stack); err != nil {
				return err
			}
			if err := b.buildRecursive(field, key, append(stack, ptrType)); err != nil {
				return err
			}
			continue
		}

		if field.Kind() == reflect.Pointer {
			// A pointer implementing updatable is *UFO[T]: declare UFO[T].
			if field.Type().Implements(reflect.TypeFor[updatable]()) {
				return fmt.Errorf("nasa: field %q must be UFO[T], not a pointer", fieldType.Name)
			}
			if field.Type().Elem().Kind() != reflect.Struct {
				return fmt.Errorf("nasa: field %q with tag %q is neither a UFO nor a struct", fieldType.Name, key)
			}
			if field.IsNil() {
				// Cycle check before allocating: a failed build must not
				// mutate the caller's struct.
				if err := checkCycle(field.Type(), stack); err != nil {
					return err
				}
				field.Set(reflect.New(field.Type().Elem()))
			} else if err := checkCycle(field.Type(), stack); err != nil {
				return err
			}
			if err := b.buildRecursive(field.Elem(), key, append(stack, field.Type())); err != nil {
				return err
			}
			continue
		}

		return fmt.Errorf("nasa: field %q with tag %q is neither a UFO nor a struct", fieldType.Name, key)
	}
	return nil
}

// checkCycle rejects pointer cycles (A contains *B, B contains *A), which
// would otherwise recurse forever: nil struct pointers are auto-allocated.
func checkCycle(t reflect.Type, stack []reflect.Type) error {
	if slices.Contains(stack, t) {
		return fmt.Errorf("nasa: config cycle detected at %s (cyclic struct pointers are not supported)", t)
	}
	return nil
}

// newRegistry builds a Registry from an explicit key map. Production code uses
// BuildRegistry; this exists for tests holding prebuilt values. Nil values panic:
// a nil in a merged map would crash the poll tick far from the mistake.
func newRegistry(name string, items map[string]updatable) Registry {
	for key, u := range items {
		if isNilUpdatable(u) {
			panic(fmt.Sprintf("nasa: nil value for key %q", key))
		}
	}
	return Registry{name: name, items: items}
}

// isNilUpdatable catches nil interfaces, typed-nil pointers and
// uninitialized (zero) values, none of which can take an update.
func isNilUpdatable(u updatable) bool {
	if u == nil {
		return true
	}
	v := reflect.ValueOf(u)
	if v.Kind() == reflect.Pointer && v.IsNil() {
		return true
	}
	return !u.isInitialized()
}

// mergeRegistries flattens registries into one lookup. A key in two registries
// is an error naming both owners — silent aliasing hid misconfigurations.
func mergeRegistries(registries []Registry) (map[string]updatable, error) {
	merged := make(map[string]updatable)
	owners := make(map[string]string)
	for _, reg := range registries {
		for key, u := range reg.items {
			if isNilUpdatable(u) {
				return nil, fmt.Errorf("nasa: nil value for key %q (registry %q)", key, reg.name)
			}
			if prev, dup := owners[key]; dup {
				return nil, fmt.Errorf("nasa: duplicate config key %q (registries %q and %q)", key, prev, reg.name)
			}
			owners[key] = reg.name
			merged[key] = u
		}
	}
	return merged, nil
}

// apply pushes fetched values into memory. Keys absent from values revert
// to their initial default; unknown DB keys (gray in the UI) are skipped;
// bad values keep the previous in-memory value.
func apply(items map[string]updatable, values map[string]string) {
	for key, u := range items {
		value, ok := values[key]
		if !ok {
			u.reset()
			continue
		}
		if err := u.update([]byte(value)); err != nil {
			slog.Error("failed to update config key", "key", key, "error", err)
		}
	}
}
