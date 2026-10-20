import type { Properties } from "tome-graph-interfaces";

export type RelationshipRecordEntry = {
  a: string;
  b: string;
  type: string;
  properties?: Properties;
};

export type RelationshipRecordRow = {
  id: string;
  nodeA: string;
  nodeB: string;
  compositeType: string;
  properties: Properties;
};

export type RelationshipProjectionRow = {
  id: string;
  recordId: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: string;
  properties: Properties;
};

/** Canonical record id: `{a}:{b}:{type}`. */
export function relationshipRecordId(a: string, b: string, type: string): string {
  return `${a}:${b}:${type}`;
}

/** Directed projection id: `{source}:{type}:{target}`. */
export function relationshipProjectionId(
  sourceNodeId: string,
  type: string,
  targetNodeId: string,
): string {
  return `${sourceNodeId}:${type}:${targetNodeId}`;
}

/** Packed projection type `{relationshipTypeId}:{0|1}`. */
export function projectionTypeForEndpoint(
  relationshipTypeId: string,
  endpointIndex: 0 | 1,
): string {
  return `${relationshipTypeId}:${endpointIndex}`;
}

/**
 * Parse a packed projection type. Allows ULID or simple test names
 * (e.g. `knows:0`) — trailing `:0` / `:1` is the endpoint index.
 */
export function parseProjectionType(
  type: string,
): { relationshipTypeId: string; endpointIndex: 0 | 1 } | null {
  const match = /^(.*):([01])$/.exec(type.trim());
  if (!match) return null;
  const relationshipTypeId = match[1]!.trim();
  if (!relationshipTypeId) return null;
  return {
    relationshipTypeId,
    endpointIndex: match[2] === "1" ? 1 : 0,
  };
}

/**
 * Map a directed (source, target, projectionType) write onto canonical
 * record endpoints. Plain composite types keep source→a, target→b.
 */
export function recordEndpointsFromProjection(
  source: string,
  target: string,
  projectionTypeOrComposite: string,
): { a: string; b: string; compositeType: string } {
  const parsed = parseProjectionType(projectionTypeOrComposite);
  if (!parsed) {
    return { a: source, b: target, compositeType: projectionTypeOrComposite.trim() };
  }
  if (parsed.endpointIndex === 1) {
    return { a: target, b: source, compositeType: parsed.relationshipTypeId };
  }
  return { a: source, b: target, compositeType: parsed.relationshipTypeId };
}

/**
 * Expand a canonical record into dual directed projections (`:0` and `:1`).
 * B1 always dual-expands (registered two-role case); no type registry.
 */
export function expandRelationshipRecord(
  entry: RelationshipRecordEntry,
): { record: RelationshipRecordRow; projections: RelationshipProjectionRow[] } {
  const properties = entry.properties ?? {};
  const recordId = relationshipRecordId(entry.a, entry.b, entry.type);
  const record: RelationshipRecordRow = {
    id: recordId,
    nodeA: entry.a,
    nodeB: entry.b,
    compositeType: entry.type,
    properties,
  };

  const projections: RelationshipProjectionRow[] = [
    projectionRow(
      recordId,
      entry.a,
      entry.b,
      projectionTypeForEndpoint(entry.type, 0),
      properties,
    ),
    projectionRow(
      recordId,
      entry.b,
      entry.a,
      projectionTypeForEndpoint(entry.type, 1),
      properties,
    ),
  ];

  return { record, projections };
}

function projectionRow(
  recordId: string,
  source: string,
  target: string,
  type: string,
  properties: Properties,
): RelationshipProjectionRow {
  return {
    id: relationshipProjectionId(source, type, target),
    recordId,
    sourceNodeId: source,
    targetNodeId: target,
    type,
    properties,
  };
}
