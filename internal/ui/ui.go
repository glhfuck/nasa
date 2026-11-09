package ui

import (
	"embed"
	"html/template"
	"io/fs"
	"net/http"
	"reflect"
	"strings"

	"github.com/glhfuck/nasa/internal/db"
)

// Key is one config key's static metadata: its Go type for display and
// a dry-run validator for writes. Plain data, no behavior.
type Key struct {
	Type        reflect.Type
	DefaultRaw  string
	Description string
	Validate    func(raw []byte) error
}

// Group is a named bundle of keys (one registry on the caller side).
type Group struct {
	Name string
	Keys map[string]Key
}

//go:embed templates/* static/*
var uiFS embed.FS

// groups is immutable after construction, so no mutex guards it.
// Values come exclusively from the database; groups are consulted
// only for key membership, validation and static types — never for values.
type configUI struct {
	groups   []Group
	store    db.Source
	template *template.Template
	handler  http.Handler
}

func newConfigUI(store db.Source, groups ...Group) *configUI {
	if store == nil {
		panic("ui: newConfigUI requires a non-nil store")
	}
	u := &configUI{
		groups:   groups,
		store:    store,
		template: template.Must(template.ParseFS(uiFS, "templates/*.html")),
	}
	u.handler = u.buildHandler()
	return u
}

func (u *configUI) buildHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ui", u.serveUI)
	mux.HandleFunc("GET /ui/api/keys", u.handleKeys)
	mux.HandleFunc("PUT /ui/api/keys/{key...}", u.putKey)
	mux.HandleFunc("DELETE /ui/api/keys/{key...}", u.deleteKey)
	// Wrong methods on a key path get the same JSON envelope as the
	// exact-path 405 below (without this, Go's mux answers text/plain).
	mux.HandleFunc("/ui/api/keys/{key...}", methodNotAllowed)
	// Plain path with no method: any wrong method lands here with a 405
	// instead of being redirected to a trailing-slash route.
	mux.HandleFunc("/ui/api/keys", methodNotAllowed)

	// Static files. Embedded assets carry no modtime, so the file server
	// emits no validators and browsers cache them heuristically — a redeploy
	// would keep serving stale panel files. no-store keeps every load fresh
	// (the panel is tiny and local; no API behavior changes).
	staticFS, err := fs.Sub(uiFS, "static")
	if err != nil {
		panic("ui: embedded static files missing: " + err.Error())
	}
	static := http.StripPrefix("/ui/static/", http.FileServer(http.FS(staticFS)))
	mux.Handle("/ui/static/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		static.ServeHTTP(w, r)
	}))

	return mux
}

// Serve mounts the config panel under /ui* and forwards the rest to next.
// A nil store or a nil next handler panics.
func Serve(store db.Source, next http.Handler, groups ...Group) http.Handler {
	if store == nil {
		panic("ui: Serve requires a non-nil store")
	}
	if next == nil {
		panic("ui: Serve requires a non-nil next handler")
	}
	inner := newConfigUI(store, groups...)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Trailing slash is not a route: send browsers to the canonical page.
		if r.URL.Path == "/ui/" {
			http.Redirect(w, r, "/ui", http.StatusMovedPermanently)
			return
		}
		if r.URL.Path == "/ui" || strings.HasPrefix(r.URL.Path, "/ui/") {
			inner.handler.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func methodNotAllowed(w http.ResponseWriter, _ *http.Request) {
	writeJSONStatus(w, http.StatusMethodNotAllowed, map[string]any{"error": "Method not allowed"})
}

// findKey returns the key metadata and true when any group owns key.
func (u *configUI) findKey(key string) (Key, bool) {
	for _, g := range u.groups {
		if k, ok := g.Keys[key]; ok {
			return k, true
		}
	}
	return Key{}, false
}
