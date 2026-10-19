import type { Graph } from "imp-core-types"
import { compileSql, graphToKysely } from "imp-sql"
import { createTomePostgresImpRegistry } from "./registry"
import { createTomePostgresSchema } from "./schema"

export interface CompiledTomeImpPostgresSql {
  sql: string
  parameters: readonly unknown[]
}

/** Lower an Imp graph against the provisional Tome Postgres relational schema. */
export function compileImpGraphToTomePostgresSql(
  graph: Graph,
): CompiledTomeImpPostgresSql {
  const compiled = graphToKysely(graph, {
    registry: createTomePostgresImpRegistry(),
    schema: createTomePostgresSchema(),
  })
  return compileSql(compiled)
}
