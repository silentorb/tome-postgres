import type { Client } from "pg";

/**
 * Single-SoT DDL: canonical relationship records + directed projection mirrors for Imp.
 * Not a separate cache database — projections are same-DB write-time denorm.
 */
export async function ensureSchema(client: Client): Promise<void> {
  // Drop connectivity-slice provisional table if present.
  await client.query(`DROP TABLE IF EXISTS relationships CASCADE`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      properties JSONB NOT NULL DEFAULT '{}'::jsonb,
      body TEXT,
      is_archived BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);

  // Connectivity-slice nodes may predate body / is_archived.
  await client.query(`
    ALTER TABLE nodes ADD COLUMN IF NOT EXISTS body TEXT;
    ALTER TABLE nodes ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS relationship_records (
      id TEXT PRIMARY KEY,
      node_a TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      node_b TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      composite_type TEXT NOT NULL,
      properties JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE (node_a, node_b, composite_type)
    );

    CREATE TABLE IF NOT EXISTS relationship_projections (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL REFERENCES relationship_records(id) ON DELETE CASCADE,
      source_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      properties JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE (source_node_id, target_node_id, type)
    );

    CREATE INDEX IF NOT EXISTS idx_rel_records_a
      ON relationship_records (node_a);
    CREATE INDEX IF NOT EXISTS idx_rel_records_b
      ON relationship_records (node_b);
    CREATE INDEX IF NOT EXISTS idx_rel_proj_source_type
      ON relationship_projections (source_node_id, type);
    CREATE INDEX IF NOT EXISTS idx_rel_proj_target_type
      ON relationship_projections (target_node_id, type);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

/** Wipe SoT graph tables (connectivity / test reset). */
export async function truncateSchema(client: Client): Promise<void> {
  await client.query(`
    TRUNCATE TABLE relationship_projections, relationship_records, nodes, meta CASCADE;
  `);
}
