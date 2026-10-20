import { Client } from "pg";
import type { Node, Properties, Relationship } from "tome-graph-interfaces";
import type {
  GraphCounts,
  MemberPageResult,
  TomeQueryCache,
} from "tome-service-interfaces";
import { relationFieldsByRowFromSqlRows } from "tome-sql";
import { redactedPostgresPath } from "./resolve-connection";
import { ensureSchema, truncateSchema } from "./schema";
import {
  deleteRelationshipFromProjection,
  writeRelationshipFromProjection,
} from "./relationship-write";
import {
  deleteExpressionIndexValues,
  getExpressionIndexDirtyMemberIds,
  getExpressionIndexStatus,
  markExpressionIndexesStale,
  markExpressionIndexesStaleForTypes,
  replaceExpressionIndexValues,
  upsertExpressionIndexValues,
} from "./expression-index";
import {
  buildMembershipCte,
  buildOutgoingProjectionOrderBy,
  compileMemberPage,
  MEMBER_DISPLAY_TITLE_SQL,
  toPostgresSql,
} from "./membership-query";

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

type ProjectionSqlRow = {
  id: string;
  record_id: string;
  source_node_id: string;
  target_node_id: string;
  type: string;
  properties: unknown;
  resolved_group_id?: string | null;
};

function mapProjectionRow(row: ProjectionSqlRow): Relationship {
  return {
    id: row.id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    type: row.type,
    properties: asProperties(row.properties),
    recordId: row.record_id,
  };
}

/**
 * Open a thin Postgres Imp/test pipe over the same SoT tables as the Base store.
 * Not a product cache path — not full `TomeQueryCache` parity.
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
      const deleted = (result.rowCount ?? 0) > 0;
      if (deleted) {
        await markExpressionIndexesStale(client);
      }
      return deleted;
    },

    async isNodeArchived(id) {
      assertOpen();
      const result = await client.query<{ is_archived: boolean }>(
        `SELECT is_archived FROM nodes WHERE id = $1`,
        [id],
      );
      return result.rows[0]?.is_archived === true;
    },

    async clearRelationshipCache() {
      assertOpen();
      await client.query(
        `TRUNCATE TABLE relationship_projections, relationship_records CASCADE`,
      );
      await markExpressionIndexesStale(client);
    },

    async upsertRelationshipRecord(_record) {
      notImplemented("upsertRelationshipRecord");
    },

    async upsertRelationshipProjection(_projection) {
      notImplemented("upsertRelationshipProjection");
    },

    async upsertRelationship(sourceNodeId, targetNodeId, type, properties = {}) {
      assertOpen();
      await writeRelationshipFromProjection(
        client,
        sourceNodeId,
        targetNodeId,
        type,
        properties,
      );
      await markExpressionIndexesStaleForTypes(
        client,
        [type],
        [sourceNodeId, targetNodeId],
      );
    },

    async mergeRelationshipProperties(id, properties) {
      assertOpen();
      const existing = await client.query<{
        source_node_id: string;
        target_node_id: string;
        type: string;
      }>(
        `SELECT source_node_id, target_node_id, type
         FROM relationship_projections WHERE id = $1`,
        [id],
      );
      await client.query(
        `UPDATE relationship_projections
         SET properties = properties || $2::jsonb
         WHERE id = $1`,
        [id, JSON.stringify(properties)],
      );
      await client.query(
        `UPDATE relationship_records r
         SET properties = r.properties || $2::jsonb
         FROM relationship_projections p
         WHERE p.id = $1 AND p.record_id = r.id`,
        [id, JSON.stringify(properties)],
      );
      const row = existing.rows[0];
      if (row) {
        await markExpressionIndexesStaleForTypes(
          client,
          [row.type],
          [row.source_node_id, row.target_node_id],
        );
      }
    },

    async deleteRelationship(sourceNodeId, targetNodeId, type) {
      assertOpen();
      const deleted = await deleteRelationshipFromProjection(
        client,
        sourceNodeId,
        targetNodeId,
        type,
      );
      if (deleted) {
        await markExpressionIndexesStaleForTypes(
          client,
          [type],
          [sourceNodeId, targetNodeId],
        );
      }
      return deleted;
    },

    async getRelationshipRecord(_id) {
      notImplemented("getRelationshipRecord");
    },

    async getRelationship(id): Promise<Relationship | null> {
      assertOpen();
      const result = await client.query<{
        id: string;
        record_id: string;
        source_node_id: string;
        target_node_id: string;
        type: string;
        properties: unknown;
      }>(
        `SELECT id, record_id, source_node_id, target_node_id, type, properties
         FROM relationship_projections WHERE id = $1`,
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
        recordId: row.record_id,
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
        `SELECT COUNT(*)::text AS n FROM relationship_projections`,
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
            record_id: string;
            source_node_id: string;
            target_node_id: string;
            type: string;
            properties: unknown;
          }>(
            `SELECT id, record_id, source_node_id, target_node_id, type, properties
             FROM relationship_projections
             WHERE source_node_id = $1 AND type = $2`,
            [sourceNodeId, type],
          )
        : await client.query<{
            id: string;
            record_id: string;
            source_node_id: string;
            target_node_id: string;
            type: string;
            properties: unknown;
          }>(
            `SELECT id, record_id, source_node_id, target_node_id, type, properties
             FROM relationship_projections WHERE source_node_id = $1`,
            [sourceNodeId],
          );
      return result.rows.map((row) => ({
        id: row.id,
        sourceNodeId: row.source_node_id,
        targetNodeId: row.target_node_id,
        type: row.type,
        properties: asProperties(row.properties),
        recordId: row.record_id,
      }));
    },
    async listRelationshipsToTarget(targetNodeId, type?) {
      assertOpen();
      const result = type
        ? await client.query<{
            id: string;
            record_id: string;
            source_node_id: string;
            target_node_id: string;
            type: string;
            properties: unknown;
          }>(
            `SELECT id, record_id, source_node_id, target_node_id, type, properties
             FROM relationship_projections
             WHERE target_node_id = $1 AND type = $2`,
            [targetNodeId, type],
          )
        : await client.query<{
            id: string;
            record_id: string;
            source_node_id: string;
            target_node_id: string;
            type: string;
            properties: unknown;
          }>(
            `SELECT id, record_id, source_node_id, target_node_id, type, properties
             FROM relationship_projections WHERE target_node_id = $1`,
            [targetNodeId],
          );
      return result.rows.map((row) => ({
        id: row.id,
        sourceNodeId: row.source_node_id,
        targetNodeId: row.target_node_id,
        type: row.type,
        properties: asProperties(row.properties),
        recordId: row.record_id,
      }));
    },
    async listOutgoingProjectionTypes(_sourceNodeId) {
      notImplemented("listOutgoingProjectionTypes");
    },
    async listOutgoingProjectionPropertyKeys(_sourceNodeId, _type) {
      notImplemented("listOutgoingProjectionPropertyKeys");
    },
    async listRelationshipsFromSourceWindow(sourceNodeId, type, query?) {
      assertOpen();
      const { orderBy, needsTargetJoin } = buildOutgoingProjectionOrderBy(
        query?.sorts,
      );
      const offsetRaw = query?.offset;
      const offset =
        typeof offsetRaw === "number" && Number.isFinite(offsetRaw) && offsetRaw > 0
          ? Math.floor(offsetRaw)
          : 0;
      const limitRaw = query?.limit;
      const limit =
        limitRaw === undefined || limitRaw === null
          ? null
          : typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0
            ? Math.floor(limitRaw)
            : null;

      const totalResult = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM relationship_projections
         WHERE source_node_id = $1 AND type = $2`,
        [sourceNodeId, type],
      );
      const total = Number(totalResult.rows[0]?.c ?? 0);

      const joinSql = needsTargetJoin
        ? "LEFT JOIN nodes n ON n.id = rp.target_node_id"
        : "";
      let selectSql = `SELECT rp.id, rp.record_id, rp.source_node_id, rp.target_node_id, rp.type,
              rp.properties
       FROM relationship_projections rp
       ${joinSql}
       WHERE rp.source_node_id = $1 AND rp.type = $2
       ${orderBy}`;
      const params: unknown[] = [sourceNodeId, type];
      if (limit !== null) {
        selectSql += ` LIMIT $3 OFFSET $4`;
        params.push(limit, offset);
      }

      const pageResult = await client.query<ProjectionSqlRow>(selectSql, params);
      return {
        relationships: pageResult.rows.map(mapProjectionRow),
        total,
      };
    },

    async listMemberPage(setId, query) {
      assertOpen();
      const emitted = compileMemberPage(setId, query, "page");
      if (emitted.empty) {
        const empty: MemberPageResult = { relationships: [], total: 0 };
        if (query.groups) empty.groupIds = [];
        if (query.relationFields && query.relationFields.length > 0) {
          empty.relationFieldsByRow = [];
        }
        return empty;
      }

      let total = 0;
      if (emitted.countSql) {
        const totalRow = await client.query<{ c: number }>(
          emitted.countSql,
          emitted.countParams,
        );
        total = Number(totalRow.rows[0]?.c ?? 0);
      }

      const offsetRaw = query.offset;
      const offset =
        typeof offsetRaw === "number" && Number.isFinite(offsetRaw) && offsetRaw > 0
          ? Math.floor(offsetRaw)
          : 0;
      const limitRaw = query.limit;
      const limit =
        limitRaw === undefined || limitRaw === null
          ? null
          : typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0
            ? Math.floor(limitRaw)
            : null;

      let pageSql = emitted.pageSql;
      const pageParams = [...emitted.pageParams];
      if (emitted.applyLimitOffset && limit !== null) {
        const base = pageParams.length;
        pageSql += ` LIMIT $${base + 1} OFFSET $${base + 2}`;
        pageParams.push(limit, offset);
      }

      const pageResult = await client.query<ProjectionSqlRow>(pageSql, pageParams);
      const rows = pageResult.rows;
      if (query.memberIds && query.memberIds.length > 0) {
        total = rows.length;
      }

      const result: MemberPageResult = {
        relationships: rows.map(mapProjectionRow),
        total,
      };
      if (emitted.includeGroupId || query.groups) {
        result.groupIds = rows.map((row) =>
          typeof row.resolved_group_id === "string" && row.resolved_group_id
            ? row.resolved_group_id
            : null,
        );
      }
      if (query.relationFields && query.relationFields.length > 0) {
        result.relationFieldsByRow = relationFieldsByRowFromSqlRows(
          rows as unknown as Record<string, unknown>[],
          emitted.relationColumns,
        );
      }
      return result;
    },

    async listMemberPageNodeIds(setId, query) {
      assertOpen();
      const emitted = compileMemberPage(setId, query, "ids");
      if (emitted.empty) return [];
      const result = await client.query<{ member_id?: string; id?: string }>(
        emitted.pageSql,
        emitted.pageParams,
      );
      return result.rows
        .map((row) => row.member_id ?? row.id!)
        .filter(Boolean);
    },

    async listRelatedTargetNodeIds(sourceNodeId, type) {
      assertOpen();
      const result = await client.query<{ id: string }>(
        `SELECT DISTINCT target_node_id AS id
         FROM relationship_projections
         WHERE source_node_id = $1 AND type = $2`,
        [sourceNodeId, type],
      );
      return result.rows.map((row) => row.id);
    },

    async listRelationshipsFromSourceForTargetIds(
      sourceNodeId,
      type,
      targetIds,
    ) {
      assertOpen();
      if (targetIds.length === 0) return [];
      const placeholders = targetIds.map((_, i) => `$${i + 3}`).join(", ");
      const result = await client.query<ProjectionSqlRow>(
        `SELECT id, record_id, source_node_id, target_node_id, type, properties
         FROM relationship_projections
         WHERE source_node_id = $1 AND type = $2
           AND target_node_id IN (${placeholders})`,
        [sourceNodeId, type, ...targetIds],
      );
      return result.rows.map(mapProjectionRow);
    },

    async listDistinctSetMemberScopeIds(setId, query) {
      assertOpen();
      const membership = buildMembershipCte(setId, query.projections ?? []);
      if (!membership) return [];

      const scopeType = query.scopeProjectionType?.trim();
      if (!scopeType) return [];

      const orderTypes = (query.scopeOrderProjectionTypes ?? [])
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      let orderExpr = "999";
      const orderParams: unknown[] = [];
      if (orderTypes.length > 0) {
        const placeholders = orderTypes.map(() => "?").join(", ");
        orderExpr = `COALESCE(
          (SELECT (NULLIF(rp.properties->>'order', ''))::double precision
           FROM relationship_projections rp
           WHERE rp.source_node_id = s.scope_id AND rp.type IN (${placeholders})
             AND rp.properties->>'order' IS NOT NULL
             AND rp.properties->>'order' <> ''
           ORDER BY (NULLIF(rp.properties->>'order', ''))::double precision ASC
           LIMIT 1),
          999
        )`;
        orderParams.push(...orderTypes);
      }

      const titleSql = MEMBER_DISPLAY_TITLE_SQL;
      const sqlWithQ = `${membership.sql},
      scopes AS (
        SELECT DISTINCT sp.target_node_id AS scope_id
        FROM members m
        INNER JOIN relationship_projections sp
          ON sp.source_node_id = m.member_id AND sp.type = ?
        UNION
        SELECT DISTINCT sp.source_node_id AS scope_id
        FROM members m
        INNER JOIN relationship_projections sp
          ON sp.target_node_id = m.member_id AND sp.type = ?
      )
      SELECT s.scope_id AS id,
             ${titleSql} AS title,
             ${orderExpr} AS sort_key
      FROM scopes s
      LEFT JOIN nodes n ON n.id = s.scope_id
      ORDER BY sort_key ASC, LOWER(${titleSql}) ASC, s.scope_id ASC`;

      const finalized = toPostgresSql(sqlWithQ, [
        ...membership.params,
        scopeType,
        scopeType,
        ...orderParams,
      ]);
      const rows = await client.query<{
        id: string;
        title: string;
        sort_key: number;
      }>(finalized.sql, finalized.params);

      return rows.rows.map((row) => ({
        id: row.id,
        title: row.title,
        sortKey:
          typeof row.sort_key === "number"
            ? row.sort_key
            : Number(row.sort_key) || 999,
      }));
    },

    async getExpressionIndexStatus(digest) {
      assertOpen();
      return getExpressionIndexStatus(client, digest);
    },
    async replaceExpressionIndexValues(digest, expressionJson, values) {
      assertOpen();
      await replaceExpressionIndexValues(client, digest, expressionJson, values);
    },
    async upsertExpressionIndexValues(digest, expressionJson, values) {
      assertOpen();
      await upsertExpressionIndexValues(client, digest, expressionJson, values);
    },
    async deleteExpressionIndexValues(digest, memberIds) {
      assertOpen();
      await deleteExpressionIndexValues(client, digest, memberIds);
    },
    async getExpressionIndexDirtyMemberIds(digest) {
      assertOpen();
      return getExpressionIndexDirtyMemberIds(client, digest);
    },
    async markExpressionIndexesStale(digest?) {
      assertOpen();
      await markExpressionIndexesStale(client, digest);
    },
    async markExpressionIndexesStaleForTypes(types, dirtyMemberIds?) {
      assertOpen();
      await markExpressionIndexesStaleForTypes(client, types, dirtyMemberIds);
    },

    async listComposedGroupHeaders(query) {
      assertOpen();
      const groupSetId = query.groupTypeDatabaseId?.trim();
      if (!groupSetId) return [];

      const membership = buildMembershipCte(
        groupSetId,
        query.groupSetProjections ?? [],
      );
      if (!membership) return [];

      const scopeType = query.groupToScopeProjectionType?.trim();
      const scopeId = query.scopeNodeId?.trim();
      const filterByScope = Boolean(scopeType && scopeId);

      const scopeFilterSql = filterByScope
        ? `WHERE (
             EXISTS (
               SELECT 1 FROM relationship_projections gsp
               WHERE gsp.source_node_id = m.member_id AND gsp.type = ? AND gsp.target_node_id = ?
             )
             OR EXISTS (
               SELECT 1 FROM relationship_projections gsp
               WHERE gsp.target_node_id = m.member_id AND gsp.type = ? AND gsp.source_node_id = ?
             )
           )`
        : "";

      const titleSql = MEMBER_DISPLAY_TITLE_SQL;
      const sortKeySql = `COALESCE(
        (SELECT (NULLIF(rp.properties->>'order', ''))::double precision
         FROM relationship_projections rp
         WHERE rp.source_node_id = m.member_id AND rp.target_node_id = ?
           AND rp.properties->>'order' IS NOT NULL AND rp.properties->>'order' <> ''
         ORDER BY (NULLIF(rp.properties->>'order', ''))::double precision ASC
         LIMIT 1),
        (SELECT (NULLIF(rp.properties->>'order', ''))::double precision
         FROM relationship_projections rp
         WHERE rp.target_node_id = m.member_id AND rp.source_node_id = ?
           AND rp.properties->>'order' IS NOT NULL AND rp.properties->>'order' <> ''
         ORDER BY (NULLIF(rp.properties->>'order', ''))::double precision ASC
         LIMIT 1),
        999
      )`;

      const sqlWithQ = `${membership.sql}
      SELECT m.member_id AS id,
             ${titleSql} AS title,
             ${sortKeySql} AS sort_key
      FROM members m
      LEFT JOIN nodes n ON n.id = m.member_id
      ${scopeFilterSql}
      ORDER BY sort_key ASC, LOWER(${titleSql}) ASC, m.member_id ASC`;

      const params: unknown[] = [
        ...membership.params,
        groupSetId,
        groupSetId,
      ];
      if (filterByScope && scopeType && scopeId) {
        params.push(scopeType, scopeId, scopeType, scopeId);
      }
      const finalized = toPostgresSql(sqlWithQ, params);
      const rows = await client.query<{
        id: string;
        title: string;
        sort_key: number;
      }>(finalized.sql, finalized.params);

      return rows.rows.map((row) => ({
        id: row.id,
        title: row.title,
        sortKey:
          typeof row.sort_key === "number"
            ? row.sort_key
            : Number(row.sort_key) || 999,
      }));
    },
    async countIncidentRelationships(nodeId) {
      assertOpen();
      const result = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM relationship_projections
         WHERE source_node_id = $1 OR target_node_id = $1`,
        [nodeId],
      );
      return Number(result.rows[0]?.n ?? 0);
    },
    async listDistinctRelationshipTypes() {
      assertOpen();
      const result = await client.query<{ type: string }>(
        `SELECT DISTINCT type FROM relationship_projections ORDER BY type`,
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
