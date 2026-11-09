# nasa — typed dynamic config for Go

[![CI](https://github.com/glhfuck/nasa/actions/workflows/ci.yml/badge.svg)](https://github.com/glhfuck/nasa/actions/workflows/ci.yml)
[![Go Reference](https://pkg.go.dev/badge/github.com/glhfuck/nasa.svg)](https://pkg.go.dev/github.com/glhfuck/nasa)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen.svg)](#install)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

*Nightly And Safe Adjustments.*

<img src="assets/logo.jpeg" alt="NASA Logo" width="540">

You know the drill: you ship a shiny new feature on Friday, and by
Friday evening it has a bug. Not a crash-the-world bug — just wrong
enough that support is melting. The fix is one line, but the feature
needs a kill switch *right now*, and that means a config change,
which means a rebuild, a redeploy pipeline, a canary, and an hour of
watching graphs instead of dinner.

Here's the Friday-evening truth: you don't have to fix the bug
tonight. You just have to turn the feature off. One boolean in a
little web panel, the poller picks it up in seconds, the broken code
goes dark — and the one-line fix waits for Monday morning, with
coffee, like a calm professional.

Meet `nasa` — *Nightly And Safe Adjustments*: runtime configuration
in Postgres/SQLite, served to your app as typed, race-safe values with
**zero external dependencies** — feature flags, limits, tunables, all of it.
A small panel shows every key live: what's set, what's missing, what's
mistyped. Ship code and config separately, turn things off without
redeploying, get your Friday evenings back.

<img src="assets/ui.png" alt="UI DEMO">

---

- [Install](#install)
- [How it works](#how-it-works)
- [1. UFO — live values](#1-ufo--live-values)
  - [Setting defaults and reading values](#setting-defaults-and-reading-values)
  - [Supported types](#supported-types)
- [2. Registry — indexing your config](#2-registry--indexing-your-config)
- [3. Poller — syncing with the database](#3-poller--syncing-with-the-database)
- [4. Web UI — the control panel](#4-web-ui--the-control-panel)
  - [What you get at `/ui`](#what-you-get-at-ui)
- [Development](#development)
- [Stability](#stability)
- [License](#license)

## Install

```sh
go get github.com/glhfuck/nasa
```

**Zero external dependencies** — `nasa` is built entirely on the Go standard library (`database/sql`, `net/http`, `sync/atomic`) and adds nothing to your `go.mod`. Requires Go ≥ 1.24 and a `*sql.DB` connection using whatever **PostgreSQL** (`pgx`, `lib/pq`) or **SQLite** (`modernc.org/sqlite`) driver your service already uses.

Create the table once:

```sql
CREATE TABLE t_nasa (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL -- JSON text: '100', '"250ms"', 'true', '{"mode":"fast"}'
);
```

---

## How it works

`nasa` is built around **three tiny primitives** and an **optional web panel**:

1. **`UFO[T]`** *(Updatable Field Object)* — a thread-safe wrapper for a single config field. Your code only ever calls `.Get()` on it.
2. **`Registry`** — scans your Go config struct once at startup and maps its `nasa` tags to database keys.
3. **`Poller`** — pulls `t_nasa` from Postgres or SQLite on a timer and atomically updates every registered `UFO` in memory.
4. **`ServeUI`** *(optional)* — mounts a built-in web dashboard at `/ui` with diff review, live search, struct templates, and one-click toggles.

---

## 1. UFO — live values

Put `nasa.UFO[T]` fields in a normal Go struct. Tag them with `nasa` to name the key and `desc` (optional) to document what the key does in the UI. Nested structs become folders:

```go
type Upstream struct {
    Host     string   `json:"host"`
    MaxConns int      `json:"max_conns"`
    Retries  int      `json:"retries"`
    Replicas []string `json:"replicas"`
}

type AppConfig struct {
    KillSwitch nasa.UFO[bool]     `nasa:"kill-switch" desc:"Emergency stop for background workers"`
    Upstream   nasa.UFO[Upstream] `nasa:"upstream"    desc:"Primary upstream endpoint"`
    Worker     WorkerConfig       `nasa:"worker"`     // folder: app/worker/*
}

type WorkerConfig struct {
    Queue     nasa.UFO[string]        `nasa:"queue"      desc:"Target queue name"`
    BatchSize nasa.UFO[int]           `nasa:"batch-size" desc:"Jobs pulled per tick"`
    Timeout   nasa.UFO[time.Duration] `nasa:"timeout"    desc:"Single job execution timeout"`
}
```

### Setting defaults and reading values

Use `nasa.New` to give a field a compiled-in default, or leave it untouched to default to the zero value of `T`:

```go
cfg := AppConfig{
    // KillSwitch is left as-is: its default is false.
    Upstream: nasa.New(Upstream{
        Host:     "api.eu.internal",
        MaxConns: 64,
        Retries:  3,
        Replicas: []string{"eu-central-1", "eu-west-1"},
    }),
    Worker: WorkerConfig{
        Queue:     nasa.New("critical"),
        BatchSize: nasa.New(50),
        Timeout:   nasa.New(250 * time.Millisecond),
    },
}
```

**Already loading your app config from YAML?** Keep parsing your config file into your struct as usual. Static YAML fields and `nasa.UFO[T]` fields can live side by side in the same struct — after `yaml.Unmarshal`, just pass `&cfg` to `BuildRegistry` to initialize the `UFO` fields and hand the registry to the `Poller`:

```go
type ServiceConfig struct {
    ListenAddr  string         `yaml:"listen_addr"`
    DatabaseURL string         `yaml:"database_url"`
    KillSwitch  nasa.UFO[bool] `nasa:"kill-switch" desc:"Emergency stop for background workers"`
    Worker      WorkerConfig   `nasa:"worker"`
}

var cfg ServiceConfig
_ = yaml.Unmarshal(rawYAML, &cfg)

// Initializes all UFO fields in cfg and indexes them for the Poller:
reg, _ := nasa.BuildRegistry(&cfg, "app")
```

Anywhere in your application, read the current value with `.Get()`:

```go
if cfg.KillSwitch.Get() {
    return ErrFeatureDisabled
}
timeout := cfg.Worker.Timeout.Get() // time.Duration, never blocks
```

### Supported types

`UFO[T]` works with any JSON-serializable Go type, plus human-readable `time.Duration` strings:

| Go field | JSON in `t_nasa.value` | Example |
|---|---|---|
| `nasa.UFO[bool]` | boolean | `true`, `false` |
| `nasa.UFO[int]` (any `int*` / `uint*`) | integer | `100`, `9223372036854775807` |
| `nasa.UFO[float64]` | number (with dot) | `0.05`, `3.14` |
| `nasa.UFO[string]` | string | `"critical"` |
| `nasa.UFO[time.Duration]` | duration string | `"250ms"`, `"5s"`, `"1h30m"` |
| `nasa.UFO[time.Time]` | RFC 3339 string | `"2026-10-15T12:00:00Z"` |
| `nasa.UFO[[]string]` | array | `["eu-central-1", "eu-west-1"]` |
| `nasa.UFO[MyStruct]` / `map[string]T` | object | `{"host": "api.eu.internal", "max_conns": 64}` |
| `nasa.UFO[*string]` | value or `null` | `"custom"` or `null` |

> **Good to know:** `Get()` returns a value copy, but slices and maps inside still share backing memory — treat returned slices and maps as read-only.

---

## 2. Registry — indexing your config

Pass `&cfg` and a group name to `BuildRegistry`. The group name acts both as the key prefix (`"app"` → `"app/worker/batch-size"`) and as the section header in the UI:

```go
reg, err := nasa.BuildRegistry(&cfg, "app")
```

If your service has several independent modules, give each its own struct and registry:

```go
appReg, _     := nasa.BuildRegistry(&appCfg, "app")
billingReg, _ := nasa.BuildRegistry(&billingCfg, "billing")
```

*(Untagged fields, `nasa:"-"`, and unexported fields are ignored. Duplicate keys fail fast with an error.)*

---

## 3. Poller — syncing with the database

`Poller` is the only thing that writes to your `UFO` fields. Call `Start(ctx)` once before serving traffic — it performs an initial synchronous fetch from `t_nasa` and launches a background goroutine that polls on every tick until `ctx` is canceled:

```go
poller, _ := nasa.NewPoller(db, 5*time.Second, appReg, billingReg)

ctx := context.Background()
if err := poller.Start(ctx); err != nil {
    log.Fatal(err)
}
```

How the poller protects your service:

- **Defaults stay active until overridden.** If a key has no row in `t_nasa`, `.Get()` returns the default you set in code (or the zero value of `T`).
- **Revert on delete.** If an override row is deleted from `t_nasa`, the next tick automatically resets the `UFO` back to its compiled-in default.
- **Type mismatches never break your service.** If a row already existed in `t_nasa` from an older deployment and a new release changes that key's Go type or struct schema (or someone writes invalid JSON manually), the poller logs the error and keeps the last valid value in memory.
- **DB hiccups don't crash the app.** If a background tick fails to query the database, in-memory values stay untouched until the DB recovers.

---

## 4. Web UI — the control panel

The poller works with plain SQL rows, so the web UI is completely optional. When you mount `nasa.ServeUI`, you get a self-contained dashboard at `/ui`:

```go
// Mount alongside your app routes (/ui* goes to nasa, the rest goes to mux):
http.ListenAndServe(":8080", nasa.ServeUI(db, mux, appReg, billingReg))

// Or run the panel on its own internal port:
http.ListenAndServe("127.0.0.1:8081", nasa.ServeUI(db, http.NewServeMux(), appReg, billingReg))
```

### What you get at `/ui`

- **Four honest key states:**
  - **Green (`In DB & Code`)** — overridden in the DB, type matches Go code.
  - **Yellow (`Code only`)** — no DB row yet; currently running on the baseline default (shown right in the row).
  - **Red (`Type mismatch`)** — the DB row doesn't match the Go type (for example, when a row in `t_nasa` predates a service rollout that changed the field's type or struct format). The UI displays the raw DB value so you can fix or reset it while the app safely runs on its fallback value.
  - **Gray (`DB only`)** — a leftover row in `t_nasa` that no registered Go struct claims; can be edited or deleted.

  ![Key states in UI](assets/colors.webp)

- **Two-step diff review.** Clicking **Save** never touches the database — it opens a side-by-side `Old → New` diff. Changes are persisted only when you click **Commit**.

  ![Two-step diff review](assets/diff.webp)

- **Boolean switches with 5-second Undo.** Flip any boolean flag with one click; a 5-second countdown toast lets you hit **Undo** before the write commits.

  ![Boolean switch with undo](assets/toggle.webp)

- **Two-click Reset & Delete.** Overridden keys (`green` / `red`) have a two-click **Reset to default** button that removes the DB override and returns the key to `yellow`. Orphan `gray` keys have a two-click **Delete** button.

  ![Two-click reset and delete](assets/double.webp)

- **Tree & flat views.** Toggle between a collapsible folder tree mapped from your `/` key paths and a compact flat list.

  ![Tree and flat views](assets/tree.webp)

- **Instant search.** Filter across key paths, values, and `desc` descriptions in real time.

  ![Instant search](assets/search.webp)

- **Light & dark themes.** Built-in theme switcher that remembers your preference in the browser.

  ![Light and dark themes](assets/theme.webp)

> **Security note:** `ServeUI` does not implement authentication of its
> own. It is designed to sit behind your internal gateway, VPN, or
> reverse-proxy auth, or to be bound to `127.0.0.1` and accessed via
> port-forwarding.

---

## Development

```sh
go vet ./...
go test -count=1 ./...
go test -C internal/db/sqlitetest -count=1 ./...
npm run check:js   # syntax check over UI ES modules
npm run test:js    # unit + jsdom DOM tests
npm run test:e2e   # SQLite-backed Playwright browser suite
```

Requires Go ≥ 1.24 and Node 26 (see CI). First time only:

```sh
npm ci
npx playwright-core install --with-deps chromium
```

See [example/](example/) for a runnable demo using in-memory SQLite (`cd example && go run .`).

## Stability

`v0`: the API is small and settling toward `v1.0`. DB-first polling, `UFO` / `Registry` / `Poller` semantics, and the `t_nasa` table schema are stable. Pin a tag in `go.mod` and check release notes when upgrading.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Daniil Aloshyn.
