# tome-postgres — agent notes

## What it is

Postgres store package for Tome. Primary entry: `openPostgresGraphStore` — authoritative **Queryable Base** against a **single SQL SoT** (nodes + `relationship_records` + same-DB `relationship_projections` mirrors for Imp; `model_documents` for model config / workspace; `archiveNodeFile` flips `nodes.is_archived`; solo `"default"` corpus). Thin `createPostgresModule` opens a SoT query handle with **product query Q1** (`listMemberPage` / relation windows via `tome-sql` Analyze/Plan + local jsonb Bind/Emit) — **not** full `TomeQueryCache` parity / CacheSync. Imp → SQL compile lives in sibling package `tome-imp-postgres`. Loaded via `tome-server` `dataStores` when configured — not an `extensions.json` kind.

## Connection

`open()` / `openPostgresGraphStore` resolve URI from `options.connectionString` / `options.uri` or `POSTGRES_URI`. Optional `clean: true` truncates SoT tables after DDL.

## Dependency rules

- May depend on `tome-graph-interfaces`, `tome-service-interfaces`, `tome-sql`, `tome-imp-postgres`, `imp-core-types`, and `pg`
- Must **not** import content loaders or codecs from `tome-db` / `tome-flatfile` unless a later design explicitly needs them

## Layout

| File | Contents |
| --- | --- |
| `src/module.ts` | `createPostgresModule()` thin Imp/test pipe |
| `src/graph-store.ts` | `openPostgresGraphStore` Queryable Base |
| `src/cache.ts` | SoT query handle + product window methods |
| `src/membership-query/` | Postgres Bind/Emit + `compileMemberPage` |
| `src/schema.ts` | Single-SoT DDL (graph + corpora + model_documents) |
| `src/model-documents.ts` | Model document empty defaults + read/write |
| `src/relationship-expand.ts` | Record → dual projection expand |
| `src/relationship-write.ts` | Record/projection write helpers |
| `src/resolve-connection.ts` | URI + redacted path |
| `src/index.ts` | Public exports |

## Run / test

```bash
bun test   # from this package or repo root
```

Live Base / connectivity tests need Postgres (`docker compose` at repo root or CI service) and `POSTGRES_URI`. Smoke + binder compile tests do not.

## See also

- Repo [AGENTS.md](../../AGENTS.md)
- Tome [graph-store.md](../../../tome/docs/features/graph-store.md) (sibling checkout)
