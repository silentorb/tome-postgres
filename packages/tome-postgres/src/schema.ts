import type { Client } from "pg";

/**
 * Provisional DDL aligned with tome-imp-postgres RelationalSchema
 * (`nodes` + `relationships` jsonb bags). Not a committed store contract.
 */
export async function ensureSchema(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      properties JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      type TEXT NOT NULL,
      properties JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE UNIQUE INDEX IF NOT EXISTS relationships_source_target_type
      ON relationships (source_node_id, target_node_id, type);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

/** Wipe provisional graph tables (connectivity / test reset). */
export async function truncateSchema(client: Client): Promise<void> {
  await client.query(`
    TRUNCATE TABLE relationships, nodes, meta;
  `);
}
