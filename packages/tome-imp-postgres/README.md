# tome-imp-postgres

Tome binder for Imp → SQL (Postgres SoT: `nodes` + `relationship_projections`). Compile-only — no mutations or driver execution.

```ts
import { compileImpGraphToTomePostgresSql } from "tome-imp-postgres"

const { sql, parameters } = compileImpGraphToTomePostgresSql(graph)
```

See package [AGENTS.md](./AGENTS.md).
