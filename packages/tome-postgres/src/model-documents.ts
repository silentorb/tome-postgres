import type { Client } from "pg";
import type {
  DynamicPropertiesFile,
  RelationshipTypesFile,
  SchemaFile,
  StoreChangeEvent,
  TableSchemasFile,
  ViewsFile,
  WorkspaceFile,
} from "tome-graph-interfaces";

type StoreChangeKind = StoreChangeEvent["kind"];

/** Solo corpus id for B2 (true multi-corpus SoT is out of scope). */
export const DEFAULT_CORPUS_ID = "default";

export type ModelDocumentKind =
  | "relationship_types"
  | "schema"
  | "views"
  | "table_schemas"
  | "dynamic_properties"
  | "workspace";

export function emptyRelationshipTypesFile(): RelationshipTypesFile {
  return { version: 1, relationshipTypes: {} };
}

export function emptySchemaFile(): SchemaFile {
  return { version: 1, relationshipRules: [], enums: {} };
}

export function emptyViewsFile(): ViewsFile {
  return { version: 2, views: [] };
}

export function emptyTableSchemasFile(): TableSchemasFile {
  return { version: 1, tables: {} };
}

export function emptyDynamicPropertiesFile(): DynamicPropertiesFile {
  return { version: 1, properties: [], columnSets: [] };
}

/** Empty workspace until the host writes one (no Marloth placeholder ids). */
export function emptyWorkspaceFile(): WorkspaceFile {
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

const EMPTY_BY_KIND: Record<ModelDocumentKind, () => unknown> = {
  relationship_types: emptyRelationshipTypesFile,
  schema: emptySchemaFile,
  views: emptyViewsFile,
  table_schemas: emptyTableSchemasFile,
  dynamic_properties: emptyDynamicPropertiesFile,
  workspace: emptyWorkspaceFile,
};

export function storeChangeKindForModel(
  kind: ModelDocumentKind,
): StoreChangeKind {
  switch (kind) {
    case "relationship_types":
      return "relationship-types";
    case "schema":
      return "schema";
    case "views":
      return "views";
    case "table_schemas":
      return "table-schemas";
    case "dynamic_properties":
      return "dynamic-properties";
    case "workspace":
      return "workspace";
  }
}

export async function readModelDocument<T>(
  client: Client,
  kind: ModelDocumentKind,
  corpusId: string = DEFAULT_CORPUS_ID,
): Promise<T> {
  const result = await client.query<{ document: unknown }>(
    `SELECT document FROM model_documents
     WHERE corpus_id = $1 AND kind = $2`,
    [corpusId, kind],
  );
  const row = result.rows[0];
  if (!row) {
    return EMPTY_BY_KIND[kind]() as T;
  }
  return row.document as T;
}

export async function writeModelDocument(
  client: Client,
  kind: ModelDocumentKind,
  document: unknown,
  corpusId: string = DEFAULT_CORPUS_ID,
): Promise<void> {
  await client.query(
    `INSERT INTO model_documents (corpus_id, kind, document)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (corpus_id, kind) DO UPDATE SET
       document = EXCLUDED.document`,
    [corpusId, kind, JSON.stringify(document)],
  );
}
