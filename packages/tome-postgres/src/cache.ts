import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { Node, Properties, Relationship } from "tome-graph-interfaces";
import type {
  GraphCounts,
  TomeQueryCache,
} from "tome-service-interfaces";
import { redactedPostgresPath } from "./resolve-connection";
import { ensureSchema, truncateSchema } from "./schema";

export type OpenPostgresCacheOptions = {
  connectionString: string;
  clean?: boolean;
};

function notImplemented(method: string): never {
  throw new Error(`tome-postgres thin cache: ${method} is not implemented`);
}

function asProperties(value: unknown): Properties {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Properties;
}

/**
 * Open a thin Postgres-backed query handle for connectivity / Imp SQL execution.
 * Implements a subset of {@link TomeQueryCache}; other methods throw.
 */
export async function openPostgresCache(
  options: OpenPostgresCacheOptions,
): Promise<TomeQueryCache> {
  const client = new Client({ connectionString: options.connectionString });
  await client.connect();
  try {
    await ensureSchema(client);
    if (options.clean) {
      await truncateSchema(client);
    }
  } catch (err) {
    await client.end().catch(() => undefined);
    throw err;
  }

  const path = redactedPostgresPath(options.connectionString);
  let closed = false;

  const assertOpen = () => {
    if (closed) {
      throw new Error("tome-postgres cache is closed");
    }
  };

  const queryAll = async <T extends Record<string, unknown>>(
    sql: string,
    ...params: unknown[]
  ): Promise<T[]> => {
    assertOpen();
    const result = await client.query(sql, params);
    return result.rows as T[];
  };

  const runExec = async (sql: string, ...params: unknown[]): Promise<void> => {
    assertOpen();
    await client.query(sql, params);
  };

  const thin: TomeQueryCache = {
    path,

    async setMeta(key, value) {
      assertOpen();
      await client.query(
        `INSERT INTO meta (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value],
      );
    },

    async getMeta(key) {
      assertOpen();
      const result = await client.query<{ value: string }>(
        `SELECT value FROM meta WHERE key = $1`,
        [key],
      );
      return result.rows[0]?.value ?? null;
    },

    async upsertNode(id, properties = {}) {
      assertOpen();
      await client.query(
        `INSERT INTO nodes (id, properties) VALUES ($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE SET properties = EXCLUDED.properties`,
        [id, JSON.stringify(properties)],
      );
    },

    async mergeNodeProperties(id, properties) {
      assertOpen();
      await client.query(
        `INSERT INTO nodes (id, properties) VALUES ($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE
         SET properties = nodes.properties || EXCLUDED.properties`,
        [id, JSON.stringify(properties)],
      );
    },

    async getNode(id): Promise<Node | null> {
      assertOpen();
      const result = await client.query<{ id: string; properties: unknown }>(
        `SELECT id, properties FROM nodes WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      if (!row) return null;
      return { id: row.id, properties: asProperties(row.properties) };
    },

    async deleteNode(id) {
      assertOpen();
      const result = await client.query(`DELETE FROM nodes WHERE id = $1`, [id]);
      return (result.rowCount ?? 0) > 0;
    },

    async isNodeArchived(_id) {
      return false;
    },

    async clearRelationshipCache() {
      assertOpen();
      await client.query(`TRUNCATE TABLE relationships`);
    },

    async upsertRelationshipRecord(_record) {
      notImplemented("upsertRelationshipRecord");
    },

    async upsertRelationshipProjection(_projection) {
      notImplemented("upsertRelationshipProjection");
    },

    async upsertRelationship(sourceNodeId, targetNodeId, type, properties = {}) {
      assertOpen();
      await client.query(
        `INSERT INTO relationships (id, source_node_id, target_node_id, type, properties)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (source_node_id, target_node_id, type) DO UPDATE SET
           properties = EXCLUDED.properties`,
        [
          randomUUID(),
          sourceNodeId,
          targetNodeId,
          type,
          JSON.stringify(properties),
        ],
      );
    },

    async mergeRelationshipProperties(id, properties) {
      assertOpen();
      await client.query(
        `UPDATE relationships
         SET properties = properties || $2::jsonb
         WHERE id = $1`,
        [id, JSON.stringify(properties)],
      );
    },

    async deleteRelationship(sourceNodeId, targetNodeId, type) {
      assertOpen();
      const result = await client.query(
        `DELETE FROM relationships
         WHERE source_node_id = $1 AND target_node_id = $2 AND type = $3`,
        [sourceNodeId, targetNodeId, type],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async getRelationshipRecord(_id) {
      notImplemented("getRelationshipRecord");
    },

    async getRelationship(id): Promise<Relationship | null> {
      assertOpen();
      const result = await client.query<{
        id: string;
        source_node_id: string;
        target_node_id: string;
        type: string;
        properties: unknown;
      }>(
        `SELECT id, source_node_id, target_node_id, type, properties
         FROM relationships WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        sourceNodeId: row.source_node_id,
        targetNodeId: row.target_node_id,
        type: row.type,
        properties: asProperties(row.properties),
      };
    },

    async listArchiveMemberIds(_archiveId, _memberPerspectives?) {
      notImplemented("listArchiveMemberIds");
    },

    async recomputeArchivedFlags(_archiveId, _memberPerspectives?) {
      notImplemented("recomputeArchivedFlags");
    },

    async counts(): Promise<GraphCounts> {
      assertOpen();
      const nodes = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM nodes`,
      );
      const relationships = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM relationships`,
      );
      return {
        nodes: Number(nodes.rows[0]?.n ?? 0),
        relationships: Number(relationships.rows[0]?.n ?? 0),
      };
    },

    async searchNodesByTitle(_pattern, _limit, _allowedTypeIds?, _allowedNodeIds?) {
      notImplemented("searchNodesByTitle");
    },
    async searchNodesByBody(_pattern, _limit, _allowedTypeIds?, _allowedNodeIds?) {
      notImplemented("searchNodesByBody");
    },
    async searchNodesLikeWindow(_pattern, _options) {
      notImplemented("searchNodesLikeWindow");
    },
    async listNodesByTitle(_limit, _allowedTypeIds?, _allowedNodeIds?) {
      notImplemented("listNodesByTitle");
    },
    async listNodesByModifiedAt(_limit, _allowedTypeIds?) {
      notImplemented("listNodesByModifiedAt");
    },
    async listNodeIdsForProjectionType(_projectionType) {
      notImplemented("listNodeIdsForProjectionType");
    },
    async listSourceNodeIdsForProjectionType(_projectionType) {
      notImplemented("listSourceNodeIdsForProjectionType");
    },
    async listNodesWithBodyLike(_pattern) {
      notImplemented("listNodesWithBodyLike");
    },
    async listNodesForGraphExport() {
      notImplemented("listNodesForGraphExport");
    },
    async listRelationshipsForGraphExport() {
      notImplemented("listRelationshipsForGraphExport");
    },
    async listRelationshipsFromSource(sourceNodeId, type?) {
      assertOpen();
      const result = type
        ? await client.query<{
            id: string;
            source_node_id: string;
            target_node_id: string;
            type: string;
            properties: unknown;
          }>(
            `SELECT id, source_node_id, target_node_id, type, properties
             FROM relationships WHERE source_node_id = $1 AND type = $2`,
            [sourceNodeId, type],
          )
        : await client.query<{
            id: string;
            source_node_id: string;
            target_node_id: string;
            type: string;
            properties: unknown;
          }>(
            `SELECT id, source_node_id, target_node_id, type, properties
             FROM relationships WHERE source_node_id = $1`,
            [sourceNodeId],
          );
      return result.rows.map((row) => ({
        id: row.id,
        sourceNodeId: row.source_node_id,
        targetNodeId: row.target_node_id,
        type: row.type,
        properties: asProperties(row.properties),
      }));
    },
    async listRelationshipsToTarget(targetNodeId, type?) {
      assertOpen();
      const result = type
        ? await client.query<{
            id: string;
            source_node_id: string;
            target_node_id: string;
            type: string;
            properties: unknown;
          }>(
            `SELECT id, source_node_id, target_node_id, type, properties
             FROM relationships WHERE target_node_id = $1 AND type = $2`,
            [targetNodeId, type],
          )
        : await client.query<{
            id: string;
            source_node_id: string;
            target_node_id: string;
            type: string;
            properties: unknown;
          }>(
            `SELECT id, source_node_id, target_node_id, type, properties
             FROM relationships WHERE target_node_id = $1`,
            [targetNodeId],
          );
      return result.rows.map((row) => ({
        id: row.id,
        sourceNodeId: row.source_node_id,
        targetNodeId: row.target_node_id,
        type: row.type,
        properties: asProperties(row.properties),
      }));
    },
    async listOutgoingProjectionTypes(_sourceNodeId) {
      notImplemented("listOutgoingProjectionTypes");
    },
    async listOutgoingProjectionPropertyKeys(_sourceNodeId, _type) {
      notImplemented("listOutgoingProjectionPropertyKeys");
    },
    async listRelationshipsFromSourceWindow(_sourceNodeId, _type, _query?) {
      notImplemented("listRelationshipsFromSourceWindow");
    },
    async listMemberPage(_setId, _query) {
      notImplemented("listMemberPage");
    },
    async listMemberPageNodeIds(_setId, _query) {
      notImplemented("listMemberPageNodeIds");
    },
    async listRelatedTargetNodeIds(_sourceNodeId, _type) {
      notImplemented("listRelatedTargetNodeIds");
    },
    async listRelationshipsFromSourceForTargetIds(
      _sourceNodeId,
      _type,
      _targetIds,
    ) {
      notImplemented("listRelationshipsFromSourceForTargetIds");
    },
    async listDistinctSetMemberScopeIds(_setId, _query) {
      notImplemented("listDistinctSetMemberScopeIds");
    },
    async getExpressionIndexStatus(_digest) {
      notImplemented("getExpressionIndexStatus");
    },
    async replaceExpressionIndexValues(_digest, _expressionJson, _values) {
      notImplemented("replaceExpressionIndexValues");
    },
    async upsertExpressionIndexValues(_digest, _expressionJson, _values) {
      notImplemented("upsertExpressionIndexValues");
    },
    async deleteExpressionIndexValues(_digest, _memberIds) {
      notImplemented("deleteExpressionIndexValues");
    },
    async getExpressionIndexDirtyMemberIds(_digest) {
      notImplemented("getExpressionIndexDirtyMemberIds");
    },
    async markExpressionIndexesStale(_digest?) {
      notImplemented("markExpressionIndexesStale");
    },
    async markExpressionIndexesStaleForTypes(_types, _dirtyMemberIds?) {
      notImplemented("markExpressionIndexesStaleForTypes");
    },
    async listComposedGroupHeaders(_query) {
      notImplemented("listComposedGroupHeaders");
    },
    async countIncidentRelationships(nodeId) {
      assertOpen();
      const result = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM relationships
         WHERE source_node_id = $1 OR target_node_id = $1`,
        [nodeId],
      );
      return Number(result.rows[0]?.n ?? 0);
    },
    async listDistinctRelationshipTypes() {
      assertOpen();
      const result = await client.query<{ type: string }>(
        `SELECT DISTINCT type FROM relationships ORDER BY type`,
      );
      return result.rows.map((row) => row.type);
    },

    queryAll,
    runExec,

    async transaction<T>(fn: (cache: TomeQueryCache) => Promise<T>): Promise<T> {
      assertOpen();
      await client.query("BEGIN");
      try {
        const result = await fn(thin);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      }
    },

    async finalize() {
      // No-op for Postgres (SQLite uses this for VACUUM-style teardown).
    },

    async close() {
      if (closed) return;
      closed = true;
      await client.end();
    },
  };

  return thin;
}
