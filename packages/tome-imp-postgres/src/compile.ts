import type { Graph } from "imp-core-types"
import { compilePostgres, compileSql } from "imp-sql"
import { createTomePostgresImpRegistry } from "./registry"
import { createTomePostgresSchema } from "./schema"

export interface CompiledTomeImpPostgresSql {
  sql: string
  parameters: readonly unknown[]
}

/**
 * Lower an Imp graph against the Tome Postgres SoT relational schema
 * (`nodes` + `relationship_projections`). Translation only — does not execute.
 */
export function compileImpGraphToTomePostgresSql(
  graph: Graph,
): CompiledTomeImpPostgresSql {
  const compiled = compilePostgres(graph, {
    registry: createTomePostgresImpRegistry(),
    schema: createTomePostgresSchema(),
  })
  return compileSql(compiled)
}
