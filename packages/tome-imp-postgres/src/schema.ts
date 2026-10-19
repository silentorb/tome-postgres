/**
 * Provisional Tome Postgres relational schema for Imp → SQL.
 * Not a committed store contract — revise when Postgres CRUD lands.
 */

import type { RelationalSchema } from "imp-sql"

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const ASSOCIATION_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

/** Provisional nodes table for Tome design/identity nodes in Postgres. */
export const TOME_POSTGRES_NODES_TABLE = "nodes"

/** Provisional relationships table. */
export const TOME_POSTGRES_RELATIONSHIPS_TABLE = "relationships"

/**
 * Encode a directed relationship-type hop as a `relationships.type` value
 * (`{relationshipTypeId}:0` or `{relationshipTypeId}:1`).
 */
export function relationshipType(relationshipTypeId: string, direction: 0 | 1): string {
  const id = relationshipTypeId.trim()
  if (!ASSOCIATION_ID_RE.test(id) && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) {
    // Allow ULID relationship types and simple test names (e.g. "knows").
    throw new Error(`Invalid relationship type / association "${relationshipTypeId}"`)
  }
  if (direction !== 0 && direction !== 1) {
    throw new Error(`direction must be 0 or 1, got ${String(direction)}`)
  }
  return `${id}:${direction}`
}

/** Map logical Imp column names onto provisional `nodes` (id column + jsonb properties). */
export function tomePostgresNodesColumnExpression(name: string): string {
  if (!IDENT_RE.test(name)) {
    throw new Error(`Invalid column name "${name}"`)
  }
  if (name === "id") {
    return name
  }
  // Postgres jsonb text extract (override SQLite json_extract defaults).
  return `(properties->>'${name}')`
}

/** Map logical edge property names onto provisional `relationships.properties` jsonb. */
export function tomePostgresEdgePropertyExpression(alias: string, name: string): string {
  if (!IDENT_RE.test(alias)) {
    throw new Error(`Invalid edges alias "${alias}"`)
  }
  if (!IDENT_RE.test(name)) {
    throw new Error(`Invalid edge property name "${name}"`)
  }
  return `(${alias}.properties->>'${name}')`
}

/**
 * Imp RelationalSchema for provisional Tome Postgres storage:
 * - Nodes: `nodes` with `id` + `properties` jsonb
 * - Relationships: type = `{ULID}:{direction}`; direction selects hop packing only
 */
export function createTomePostgresSchema(): RelationalSchema {
  return {
    table: TOME_POSTGRES_NODES_TABLE,
    column: tomePostgresNodesColumnExpression,
    nodePropertiesJson(alias: string): string {
      if (!IDENT_RE.test(alias)) {
        throw new Error(`Invalid table alias "${alias}"`)
      }
      return `${alias}.properties`
    },
    edges: {
      table: TOME_POSTGRES_RELATIONSHIPS_TABLE,
      sourceColumn: "source_node_id",
      targetColumn: "target_node_id",
      typeColumn: "type",
      propertiesColumn: "properties",
      property: tomePostgresEdgePropertyExpression,
      propertiesJson(alias: string): string {
        if (!IDENT_RE.test(alias)) {
          throw new Error(`Invalid edges alias "${alias}"`)
        }
        return `${alias}.properties`
      },
    },
    edgeType(association: string, direction: number) {
      if (direction !== 0 && direction !== 1) {
        throw new Error(`direction must be 0 or 1, got ${String(direction)}`)
      }
      return relationshipType(association, direction as 0 | 1)
    },
  }
}

/** Default provisional schema instance. */
export const tomePostgresSchema = createTomePostgresSchema()
