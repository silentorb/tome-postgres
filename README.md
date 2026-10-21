# tome-postgres

Postgres backend packages for [Tome](https://github.com/silentorb/tome). This repo **depends on Tome** (interfaces / store module contracts) and **[imp-ts](https://github.com/silentorb/imp-ts)** (`imp-sql`) for Imp → SQL — Tome does **not** depend on this repo. Hosts load adapters via `tome-server` `dataStores` when configured.

Heavy Postgres runtime and CI live here so tome’s light weighted test suite stays lean. Imp → SQL compile tests do not need a live database; Base / connectivity tests do (`POSTGRES_URI`).

## Packages

| Package | Role |
| --- | --- |
| `packages/tome-postgres` | Queryable Base on a **single SQL SoT** (model documents; archive flag; solo corpus). Host `dataStores` factories: **`createPostgresStoreModule`**, **`createPostgresFtsModule`** (same-DB FTS, no sync). Thin `createPostgresModule` for Imp/tests. Product windows + expression indexes on the thin cache pipe. **No CacheSync.** See tome `tome-server.postgres.example.json`. |
| `packages/tome-imp-postgres` | Thin Tome binder: Imp → SQL via `compilePostgres` against `relationship_projections` |

## Layout (workbench)

Clone as a sibling of `tome` and `imp-ts`. Mount path: `.mnt/tome-postgres` (`TOME_POSTGRES_REPO` override).

```
../tome/
../imp-ts/
../tome-postgres/   ← this repo
```

## Local Postgres

Official Postgres 16 image:

```bash
docker compose up -d
```

| Port | Use |
| --- | --- |
| `5432` | Postgres |

Default auth (dev only): user/db `tome`, password `tome-postgres-dev`. Override with `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`.

Connection URI for `open()` / tests (`POSTGRES_URI` or `options.connectionString` / `options.uri`):

| Where tests run | Example URI |
| --- | --- |
| Host / CI service container | `postgres://tome:tome-postgres-dev@localhost:5432/tome` |
| Inside silentorb-workbench container (Compose sidecar published on host) | `postgres://tome:tome-postgres-dev@host.docker.internal:5432/tome` |

Stop: `docker compose down`.

## Develop / verify

Requires siblings `../tome` and `../imp-ts` (workspaces pull interfaces + Imp packages).

```bash
bun install
bun run typecheck
# Optional live DB:
export POSTGRES_URI=postgres://tome:tome-postgres-dev@localhost:5432/tome
bun test
```

Without `POSTGRES_URI` (or when unreachable), live Base / connectivity tests skip; compile + smoke still run.

From silentorb-workbench: `bash scripts/run-in-tome-postgres.sh run test` (when mounted; set `POSTGRES_URI` for live tests).

## CI

GitHub Actions checks out this repo plus `silentorb/tome` and `silentorb/imp-ts` as siblings, starts Postgres as a service container with `POSTGRES_URI`, then runs typecheck + tests.

## See also

- Task: [postgresql-support.md](https://github.com/silentorb/tome/blob/main/tasks/postgresql-support.md)
- [graph-store.md](https://github.com/silentorb/tome/blob/main/docs/features/graph-store.md) (adapter family + LCD uniformity)
- Imp SQL: [imp-ts](https://github.com/silentorb/imp-ts) (`docs/features/sql.md`)
