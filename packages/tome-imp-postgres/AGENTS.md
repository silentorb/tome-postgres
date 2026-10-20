# tome-imp-postgres — agent notes

## What it is

Thin Tome binder for Imp → SQL against the Postgres single SoT (`nodes` + `relationship_projections` with jsonb `properties`; relationship `type` = `{ULID}:{direction}`). Compile-only — no `pg` driver or store module. Canonical writes live in `relationship_records` (maintained by `tome-postgres`).

## Dependency rules

- Depends on `imp-sql` and Imp packages (`imp-core-types`, `imp-registry`, `imp-collection-transforms`, `imp-pathing`)
- Must **not** import `tome-db`, `tome-editor`, `tome-imp-sql`, or the `tome-postgres` store package for compile

## Layout

| Path | Role |
| --- | --- |
| `src/schema.ts` | `createTomePostgresSchema`, table name constants |
| `src/registry.ts` | `createTomePostgresImpRegistry` (core + transforms + pathing) |
| `src/compile.ts` | `compileImpGraphToTomePostgresSql` |
| `tests/` | Compile string/param tests (no Postgres) |

## Run

```bash
bun test   # from this package or repo root
```

## See also

- Repo [AGENTS.md](../../AGENTS.md)
- Imp SQL: sibling `imp-ts` → `docs/features/sql.md`
- SQLite binder analogue: `tome` → `packages/tome-imp-sql`
