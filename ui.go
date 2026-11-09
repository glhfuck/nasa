package nasa

import (
	"database/sql"
	"net/http"

	"github.com/glhfuck/nasa/internal/db"
	"github.com/glhfuck/nasa/internal/ui"
)

// ServeUI mounts the optional config panel under /ui* and forwards the
// rest to next. It reads and writes the database directly: the Poller is
// not involved (it only feeds app memory on its ticks). A nil database
// or a nil next handler panics. The panel has no auth of its own: expose
// it on localhost or gate /ui* behind auth/a reverse proxy.
func ServeUI(database *sql.DB, next http.Handler, registries ...Registry) http.Handler {
	if database == nil {
		panic("ui: Serve requires a non-nil *sql.DB")
	}
	return serveUIWithSource(db.NewSQLSource(database), next, registries...)
}

func serveUIWithSource(source db.Source, next http.Handler, registries ...Registry) http.Handler {
	groups := make([]ui.Group, len(registries))
	for i, r := range registries {
		keys := make(map[string]ui.Key, len(r.items))
		for k, u := range r.items {
			keys[k] = ui.Key{
				Type:        u.staticType(),
				DefaultRaw:  u.defaultRaw(),
				Description: r.descs[k],
				Validate:    u.validate,
			}
		}
		groups[i] = ui.Group{Name: r.name, Keys: keys}
	}
	return ui.Serve(source, next, groups...)
}
