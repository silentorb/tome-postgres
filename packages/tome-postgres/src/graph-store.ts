import { Client } from "pg";
import type { Graph } from "imp-core-types";
import type {
  ExecuteImpContext,
  ImpCollectionResult,
  ImpGraph,
  ListRelationshipProjectionsOptions,
  Node,
  Properties,
  Relationship,
  RelationshipRecordRef,
  StoreChangeListener,
  TomeCorpusInfo,
  TomeGraphStoreQueryable,
  WorkspaceFile,
} from "tome-graph-interfaces";
import { compileImpGraphToTomePostgresSql } from "tome-imp-postgres";
import { redactedPostgresPath } from "./resolve-connection";
import { ensureSchema, truncateSchema } from "./schema";
import {
  deleteRelationshipFromProjection,
  deleteRelationshipRecord,
  writeRelationshipFromProjection,
  writeRelationshipRecord,
} from "./relationship-write";

export type OpenPostgresGraphStoreOptions = {
  connectionString: string;
  clean?: boolean;
};

function notImplemented(method: string): never {
  throw new Error(`tome-postgres Base B1: ${method} is not implemented`);
}

function asProperties(value: unknown): Properties {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Properties;
}

function emptyWorkspace(): WorkspaceFile {
  return {
    version: 1,
    homeNodeId: "",
    archiveNodeId: "",
    protectedNodeIds: [],
    graphExplorer: { defaultAnchorNodeId: "" },
    staticSite: { homeNodeId: "" },
    quickLinks: [],
  };
}

function applyParameters(
  graph: Graph,
  parameters?: Record<string, unknown>,
): Graph {
  if (!parameters || Object.keys(parameters).length === 0) return graph;
  const nodes = { ...graph.nodes };
  for (const node of Object.values(nodes)) {
    if (node.type !== "parameter") continue;
    const label = node.inputs?.label;
    if (typeof label !== "string" || !(label in parameters)) continue;
    nodes[node.id] = {
      ...node,
      inputs: {
        ...node.inputs,
        value: parameters[label] as string | number | boolean | null,
      },
    };
  }
  return { ...graph, nodes };
}

/**
 * Open an authoritative Postgres Queryable graph store (single SoT, no full cache).
 */
export async function openPostgresGraphStore(
  options: OpenPostgresGraphStoreOptions,
): Promise<TomeGraphStoreQueryable> {
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

  const contentDir = redactedPostgresPath(options.connectionString);
  const listeners = new Set<StoreChangeListener>();
  let closed = false;
  let watching = false;

  const assertOpen = () => {
    if (closed) {
      throw new Error("tome-postgres graph store is closed");
    }
  };

  const emit = (kind: "node" | "relationships") => {
    const event = { path: contentDir, kind };
    for (const listener of listeners) {
      listener(event);
    }
  };

  const queryAll = async (
    sql: string,
    ...params: unknown[]
  ): Promise<Record<string, unknown>[]> => {
    assertOpen();
    const result = await client.query(sql, params);
    return result.rows as Record<string, unknown>[];
  };

  const soloCorpus: TomeCorpusInfo = {
    id: "default",
    contentDir,
    access: "readwrite",
    workspace: emptyWorkspace(),
  };

  const store: TomeGraphStoreQueryable = {
    capabilities: { queryable: true, impExecution: "sql" },
    contentDir,

    async close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      await client.end();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    startWatching() {
      watching = true;
    },

    stopWatching() {
      watching = false;
    },

    listCorpora() {
      return [soloCorpus];
    },

    locateNode(_id) {
      return soloCorpus.id;
    },

    contentDirForNode(_nodeId) {
      return contentDir;
    },

    async listNodeIds() {
      assertOpen();
      const result = await client.query<{ id: string }>(
        `SELECT id FROM nodes ORDER BY id`,
      );
      return result.rows.map((row) => row.id);
    },

    async getNode(id) {
      assertOpen();
      const result = await client.query<{
        id: string;
        properties: unknown;
        body: string | null;
      }>(`SELECT id, properties, body FROM nodes WHERE id = $1`, [id]);
      const row = result.rows[0];
      if (!row) return null;
      const properties = asProperties(row.properties);
      if (row.body != null && properties.body === undefined) {
        properties.body = row.body;
      }
      return { id: row.id, properties };
    },

    async upsertNode(node: Node, body?: string) {
      assertOpen();
      const bodyValue =
        body !== undefined
          ? body
          : typeof node.properties.body === "string"
            ? node.properties.body
            : null;
      await client.query(
        `INSERT INTO nodes (id, properties, body, is_archived)
         VALUES ($1, $2::jsonb, $3, FALSE)
         ON CONFLICT (id) DO UPDATE SET
           properties = EXCLUDED.properties,
           body = COALESCE(EXCLUDED.body, nodes.body)`,
        [node.id, JSON.stringify(node.properties), bodyValue],
      );
      emit("node");
    },

    async upsertNodeToCorpus(_corpusId, _node, _body?) {
      notImplemented("upsertNodeToCorpus");
    },

    async mergeNodeProperties(id, patch) {
      assertOpen();
      const result = await client.query(
        `UPDATE nodes
         SET properties = properties || $2::jsonb
         WHERE id = $1`,
        [id, JSON.stringify(patch)],
      );
      if ((result.rowCount ?? 0) > 0) {
        emit("node");
        return true;
      }
      return false;
    },

    async deleteNode(id) {
      assertOpen();
      const result = await client.query(`DELETE FROM nodes WHERE id = $1`, [id]);
      if ((result.rowCount ?? 0) > 0) {
        emit("node");
      }
    },

    async archiveNodeFile(_id) {
      notImplemented("archiveNodeFile");
    },

    async unarchiveNodeFile(_id) {
      notImplemented("unarchiveNodeFile");
    },

    async getRelationshipRecord(a, b, type) {
      assertOpen();
      const result = await client.query<{
        node_a: string;
        node_b: string;
        composite_type: string;
        properties: unknown;
      }>(
        `SELECT node_a, node_b, composite_type, properties
         FROM relationship_records
         WHERE node_a = $1 AND node_b = $2 AND composite_type = $3`,
        [a, b, type],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        a: row.node_a,
        b: row.node_b,
        type: row.composite_type,
        properties: asProperties(row.properties),
      };
    },

    async findRelationshipRecord(a, b, type) {
      const record = await store.getRelationshipRecord(a, b, type);
      if (!record) return null;
      return {
        id: `${record.a}:${record.type}:${record.b}`,
        sourceNodeId: record.a,
        targetNodeId: record.b,
        type: record.type,
        properties: record.properties ?? {},
        recordId: `${record.a}:${record.b}:${record.type}`,
      };
    },

    async upsertRelationshipRecord(entry: RelationshipRecordRef) {
      assertOpen();
      await writeRelationshipRecord(client, {
        a: entry.a,
        b: entry.b,
        type: entry.type,
        properties: entry.properties ?? {},
      });
      emit("relationships");
    },

    async deleteRelationshipRecord(a, b, type) {
      assertOpen();
      const deleted = await deleteRelationshipRecord(client, a, b, type);
      if (deleted) emit("relationships");
      return deleted;
    },

    async upsertRelationship(source, target, projectionType, properties = {}) {
      assertOpen();
      await writeRelationshipFromProjection(
        client,
        source,
        target,
        projectionType,
        properties,
      );
      emit("relationships");
    },

    async deleteRelationship(source, target, projectionType) {
      assertOpen();
      const deleted = await deleteRelationshipFromProjection(
        client,
        source,
        target,
        projectionType,
      );
      if (deleted) emit("relationships");
      return deleted;
    },

    async mergeRelationshipProperties(source, target, projectionType, patch) {
      assertOpen();
      const existing = await client.query<{
        node_a: string;
        node_b: string;
        composite_type: string;
        properties: unknown;
      }>(
        `SELECT r.node_a, r.node_b, r.composite_type, r.properties
         FROM relationship_projections p
         JOIN relationship_records r ON r.id = p.record_id
         WHERE p.source_node_id = $1 AND p.target_node_id = $2 AND p.type = $3`,
        [source, target, projectionType],
      );
      const row = existing.rows[0];
      if (!row) {
        await writeRelationshipFromProjection(
          client,
          source,
          target,
          projectionType,
          patch,
        );
      } else {
        await writeRelationshipRecord(client, {
          a: row.node_a,
          b: row.node_b,
          type: row.composite_type,
          properties: { ...asProperties(row.properties), ...patch },
        });
      }
      emit("relationships");
    },

    async replaceRelationshipProperties(
      source,
      target,
      projectionType,
      properties,
    ) {
      assertOpen();
      const existing = await client.query<{
        node_a: string;
        node_b: string;
        composite_type: string;
      }>(
        `SELECT r.node_a, r.node_b, r.composite_type
         FROM relationship_projections p
         JOIN relationship_records r ON r.id = p.record_id
         WHERE p.source_node_id = $1 AND p.target_node_id = $2 AND p.type = $3`,
        [source, target, projectionType],
      );
      const row = existing.rows[0];
      if (!row) return false;
      await writeRelationshipRecord(client, {
        a: row.node_a,
        b: row.node_b,
        type: row.composite_type,
        properties,
      });
      emit("relationships");
      return true;
    },

    async readRelationshipTypes() {
      notImplemented("readRelationshipTypes");
    },
    async writeRelationshipTypes(_file) {
      notImplemented("writeRelationshipTypes");
    },
    async readSchema() {
      notImplemented("readSchema");
    },
    async writeSchema(_file) {
      notImplemented("writeSchema");
    },
    async readViews() {
      notImplemented("readViews");
    },
    async writeViews(_file) {
      notImplemented("writeViews");
    },
    async readTableSchemas() {
      notImplemented("readTableSchemas");
    },
    async writeTableSchemas(_file) {
      notImplemented("writeTableSchemas");
    },
    async readWorkspace() {
      notImplemented("readWorkspace");
    },
    async writeWorkspace(_file) {
      notImplemented("writeWorkspace");
    },
    async writeWorkspaceForCorpus(_corpusId, _file) {
      notImplemented("writeWorkspaceForCorpus");
    },
    async readDynamicProperties() {
      notImplemented("readDynamicProperties");
    },
    async writeDynamicProperties(_file) {
      notImplemented("writeDynamicProperties");
    },

    async isNodeArchived(id) {
      assertOpen();
      const result = await client.query<{ is_archived: boolean }>(
        `SELECT is_archived FROM nodes WHERE id = $1`,
        [id],
      );
      return result.rows[0]?.is_archived === true;
    },

    async forEachRelationshipRecord(fn, _options?) {
      assertOpen();
      const result = await client.query<{
        node_a: string;
        node_b: string;
        composite_type: string;
        properties: unknown;
      }>(
        `SELECT node_a, node_b, composite_type, properties
         FROM relationship_records
         ORDER BY node_a, node_b, composite_type`,
      );
      for (const row of result.rows) {
        await fn({
          a: row.node_a,
          b: row.node_b,
          type: row.composite_type,
          properties: asProperties(row.properties),
        });
      }
    },

    async listRelationshipProjections(
      nodeId,
      options?: ListRelationshipProjectionsOptions,
    ) {
      assertOpen();
      const direction = options?.direction ?? "both";
      const projectionType = options?.projectionType;
      const clauses: string[] = [];
      const params: unknown[] = [];

      if (direction === "from") {
        params.push(nodeId);
        clauses.push(`source_node_id = $${params.length}`);
      } else if (direction === "to") {
        params.push(nodeId);
        clauses.push(`target_node_id = $${params.length}`);
      } else {
        params.push(nodeId);
        clauses.push(
          `(source_node_id = $${params.length} OR target_node_id = $${params.length})`,
        );
      }

      if (projectionType) {
        params.push(projectionType);
        clauses.push(`type = $${params.length}`);
      }

      const result = await client.query<{
        id: string;
        record_id: string;
        source_node_id: string;
        target_node_id: string;
        type: string;
        properties: unknown;
      }>(
        `SELECT id, record_id, source_node_id, target_node_id, type, properties
         FROM relationship_projections
         WHERE ${clauses.join(" AND ")}
         ORDER BY id`,
        params,
      );

      return result.rows.map(
        (row): Relationship => ({
          id: row.id,
          sourceNodeId: row.source_node_id,
          targetNodeId: row.target_node_id,
          type: row.type,
          properties: asProperties(row.properties),
          recordId: row.record_id,
        }),
      );
    },

    async executeImp(
      graph: ImpGraph,
      context?: ExecuteImpContext,
    ): Promise<ImpCollectionResult> {
      assertOpen();
      const prepared = applyParameters(graph as Graph, context?.parameters);
      const { sql, parameters } = compileImpGraphToTomePostgresSql(prepared);
      const rows = await queryAll(sql, ...parameters);
      return {
        columns: rows[0] ? Object.keys(rows[0]) : ["id"],
        rows,
      };
    },

    queryAll,
  };

  // Silence unused watching in B1 (fs watch is a no-op).
  void watching;

  return store;
}
