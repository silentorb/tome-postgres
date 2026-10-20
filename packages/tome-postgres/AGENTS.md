# tome-postgres — agent notes

## What it is

Postgres store-module package for Tome (`createPostgresModule`). Opens a thin `pg`-backed `TomeQueryCache` against a provisional `nodes` / `relationships` schema (upsert + `queryAll` / `runExec`). SQLite-shaped cache APIs (membership pages, expression indexes, etc.) and authoritative Base store remain unimplemented (throw). Imp → SQL compile lives in sibling package `tome-imp-postgres`. Loaded via `tome-server` `dataStores` when configured — not an `extensions.json` kind.

## Connection

`open()` resolves URI from `options.connectionString` / `options.uri` or `POSTGRES_URI`. Optional `clean: true` truncates provisional tables after DDL.

## Dependency rules

- May depend on `tome-graph-interfaces`, `tome-service-interfaces`, and `pg`
- Must **not** import content loaders or codecs from `tome-db` / `tome-flatfile` unless a later design explicitly needs them
- Binder (`tome-imp-postgres`) is a **devDependency** for connectivity tests only

## Layout

| File | Contents |
| --- | --- |
| `src/module.ts` | `createPostgresModule()` |
| `src/cache.ts` | Thin `openPostgresCache` |
| `src/schema.ts` | Provisional DDL |
| `src/resolve-connection.ts` | URI + redacted path |
| `src/index.ts` | Public exports |

## Run / test

```bash
bun test   # from this package or repo root
```

Connectivity tests need Postgres (`docker compose` at repo root or CI service) and `POSTGRES_URI`. Smoke + binder compile tests do not.

## See also

- Repo [AGENTS.md](../../AGENTS.md)
- Tome [graph-store.md](../../../tome/docs/features/graph-store.md) (sibling checkout)
