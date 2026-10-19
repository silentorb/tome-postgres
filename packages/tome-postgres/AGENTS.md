# tome-postgres — agent notes

## What it is

Postgres store-module package for Tome (`createPostgresModule`). Stub only until graph CRUD lands. Imp → SQL compile lives in sibling package `tome-imp-postgres`. Loaded via `tome-server` `dataStores` when configured — not an `extensions.json` kind.

## Dependency rules

- May depend on `tome-graph-interfaces` and `tome-service-interfaces`
- Must **not** import content loaders or codecs from `tome-db` / `tome-flatfile` unless a later design explicitly needs them

## Layout

| File | Contents |
| --- | --- |
| `src/module.ts` | `createPostgresModule()` |
| `src/index.ts` | Public exports |

## Run / test

```bash
bun test   # from this package or repo root
```

Connectivity / SQL execution tests will need Postgres (`docker compose` at repo root or CI service). Current smoke tests do not require a live database.

## See also

- Repo [AGENTS.md](../../AGENTS.md)
- Tome [graph-store.md](../../../tome/docs/features/graph-store.md) (sibling checkout)
