# AGENTS Guide — tome-postgres

## Repository purpose

Postgres adapters for Tome as **store modules** loaded via `dataStores` (same seam as `tome-sqlite`), plus a thin Imp → SQL binder. This repo depends on Tome packages and sibling `imp-ts`; Tome core must not take a hard dependency on Postgres.

| Package | Role |
| --- | --- |
| `packages/tome-postgres` | `createPostgresModule()` stub; future Postgres graph store |
| `packages/tome-imp-postgres` | `compileImpGraphToTomePostgresSql` — provisional Postgres schema binder |

## Cross-adapter uniformity (LCD, nice-to-have)

Database adapters — integrated SQLite (`tome-sqlite` / `tome-imp-sql` in tome), sibling Neo4j (`tome-neo4j`), this repo, and any future adapters — should share a lowest-common-denominator uniform structure and design patterns (module factory + `dataStores` seam, Imp compile binder package shape, docs/verify conventions). Uniformity is **not essential** (dialects and packaging may diverge). When making **significant fundamental** changes to one adapter, prefer mirroring those changes in the others when practical. See tome → `docs/features/graph-store.md`.

## Dependency direction

- **May** depend on `tome-graph-interfaces`, `tome-service-interfaces`, and Imp packages (including `imp-sql`) as needed
- Root workspaces include sibling `../tome/packages/…` and `../imp-ts/packages/*`
- **Must not** require changes to tome’s `workspaces` to develop or test this repo
- Graph backends are **not** `extensions.json` kinds — use store/cache modules

## Project context

- Bun workspaces; `bun install` from repo root (siblings `../tome`, `../imp-ts` required)
- Postgres via `docker compose` (port 5432); CI uses the same image as a service container
- Keep Postgres out of tome’s release image and default weighted suite
- Imp → SQL compile tests do not need a live database

## Verify

```bash
bun run typecheck
bun test
```

Workbench (when mounted): `bash scripts/run-in-tome-postgres.sh run test`.

## Feature docs (in tome / imp-ts)

| Topic | Doc |
| --- | --- |
| Graph store contracts + adapter family | `tome` → `docs/features/graph-store.md` |
| Imp → SQL translator | `imp-ts` → `docs/features/sql.md` |
| Backlog | `tome` → `tasks/postgresql-support.md` |
