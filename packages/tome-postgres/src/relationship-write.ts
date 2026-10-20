import type { Client } from "pg";
import type { Properties } from "tome-graph-interfaces";
import {
  expandRelationshipRecord,
  recordEndpointsFromProjection,
  type RelationshipRecordEntry,
} from "./relationship-expand";

/** Upsert a canonical record and replace its directed projection mirrors. */
export async function writeRelationshipRecord(
  client: Client,
  entry: RelationshipRecordEntry,
): Promise<void> {
  const { record, projections } = expandRelationshipRecord(entry);
  const propsJson = JSON.stringify(record.properties);

  const upsert = await client.query<{ id: string }>(
    `INSERT INTO relationship_records (id, node_a, node_b, composite_type, properties)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (node_a, node_b, composite_type) DO UPDATE SET
       properties = EXCLUDED.properties
     RETURNING id`,
    [record.id, record.nodeA, record.nodeB, record.compositeType, propsJson],
  );
  const recordId = upsert.rows[0]!.id;

  await client.query(`DELETE FROM relationship_projections WHERE record_id = $1`, [
    recordId,
  ]);

  for (const proj of projections) {
    await client.query(
      `INSERT INTO relationship_projections
         (id, record_id, source_node_id, target_node_id, type, properties)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (source_node_id, target_node_id, type) DO UPDATE SET
         id = EXCLUDED.id,
         record_id = EXCLUDED.record_id,
         properties = EXCLUDED.properties`,
      [
        proj.id,
        recordId,
        proj.sourceNodeId,
        proj.targetNodeId,
        proj.type,
        JSON.stringify(proj.properties),
      ],
    );
  }
}

/** Upsert from a directed projection write (thin cache / Base projection API). */
export async function writeRelationshipFromProjection(
  client: Client,
  source: string,
  target: string,
  projectionTypeOrComposite: string,
  properties: Properties = {},
): Promise<void> {
  const { a, b, compositeType } = recordEndpointsFromProjection(
    source,
    target,
    projectionTypeOrComposite,
  );
  await writeRelationshipRecord(client, {
    a,
    b,
    type: compositeType,
    properties,
  });
}

export async function deleteRelationshipRecord(
  client: Client,
  a: string,
  b: string,
  type: string,
): Promise<boolean> {
  const result = await client.query(
    `DELETE FROM relationship_records
     WHERE node_a = $1 AND node_b = $2 AND composite_type = $3`,
    [a, b, type],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteRelationshipFromProjection(
  client: Client,
  source: string,
  target: string,
  projectionTypeOrComposite: string,
): Promise<boolean> {
  const { a, b, compositeType } = recordEndpointsFromProjection(
    source,
    target,
    projectionTypeOrComposite,
  );
  return deleteRelationshipRecord(client, a, b, compositeType);
}
