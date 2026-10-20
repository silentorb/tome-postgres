import type { Client } from "pg";

export type ExpressionIndexStatus = "ready" | "stale" | "building" | "missing";

function asStringArray(value: unknown): string[] | null {
  if (value == null) return null;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0,
  );
}

function reachTypesFromExpressionJson(expressionJson: unknown): string[] | null {
  let parsed: unknown = expressionJson;
  if (typeof expressionJson === "string") {
    try {
      parsed = JSON.parse(expressionJson);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const raw = (parsed as { reachTypes?: unknown }).reachTypes;
  if (!Array.isArray(raw)) return null;
  return raw.filter((t): t is string => typeof t === "string");
}

export async function getExpressionIndexStatus(
  client: Client,
  digest: string,
): Promise<ExpressionIndexStatus> {
  const result = await client.query<{ status: string }>(
    `SELECT status FROM expression_indexes WHERE digest = $1`,
    [digest],
  );
  const row = result.rows[0];
  if (!row) return "missing";
  if (row.status === "ready" || row.status === "stale" || row.status === "building") {
    return row.status;
  }
  return "stale";
}

export async function getExpressionIndexDirtyMemberIds(
  client: Client,
  digest: string,
): Promise<string[] | null> {
  const result = await client.query<{ dirty_member_ids: unknown }>(
    `SELECT dirty_member_ids FROM expression_indexes WHERE digest = $1`,
    [digest],
  );
  const row = result.rows[0];
  if (!row) return null;
  return asStringArray(row.dirty_member_ids);
}

export async function replaceExpressionIndexValues(
  client: Client,
  digest: string,
  expressionJson: string,
  values: readonly { memberId: string; sortValue: number }[],
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO expression_indexes (digest, status, built_at, expression_json, dirty_member_ids)
       VALUES ($1, 'building', NULL, $2::jsonb, NULL)
       ON CONFLICT (digest) DO UPDATE SET
         status = 'building',
         expression_json = EXCLUDED.expression_json,
         dirty_member_ids = NULL`,
      [digest, expressionJson],
    );
    await client.query(`DELETE FROM expression_index_values WHERE digest = $1`, [
      digest,
    ]);
    for (const row of values) {
      await client.query(
        `INSERT INTO expression_index_values (digest, member_id, sort_value)
         VALUES ($1, $2, $3)`,
        [digest, row.memberId, row.sortValue],
      );
    }
    await client.query(
      `UPDATE expression_indexes
       SET status = 'ready', built_at = $1, dirty_member_ids = NULL
       WHERE digest = $2`,
      [new Date().toISOString(), digest],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

export async function upsertExpressionIndexValues(
  client: Client,
  digest: string,
  expressionJson: string,
  values: readonly { memberId: string; sortValue: number }[],
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO expression_indexes (digest, status, built_at, expression_json, dirty_member_ids)
       VALUES ($1, 'building', NULL, $2::jsonb, NULL)
       ON CONFLICT (digest) DO UPDATE SET
         status = 'building',
         expression_json = EXCLUDED.expression_json`,
      [digest, expressionJson],
    );
    for (const row of values) {
      await client.query(
        `INSERT INTO expression_index_values (digest, member_id, sort_value)
         VALUES ($1, $2, $3)
         ON CONFLICT (digest, member_id) DO UPDATE SET sort_value = EXCLUDED.sort_value`,
        [digest, row.memberId, row.sortValue],
      );
    }
    await client.query(
      `UPDATE expression_indexes
       SET status = 'ready', built_at = $1, dirty_member_ids = NULL
       WHERE digest = $2`,
      [new Date().toISOString(), digest],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

export async function deleteExpressionIndexValues(
  client: Client,
  digest: string,
  memberIds: readonly string[],
): Promise<void> {
  if (memberIds.length === 0) return;
  const placeholders = memberIds.map((_, i) => `$${i + 2}`).join(", ");
  await client.query(
    `DELETE FROM expression_index_values
     WHERE digest = $1 AND member_id IN (${placeholders})`,
    [digest, ...memberIds],
  );
}

export async function markExpressionIndexesStale(
  client: Client,
  digest?: string,
): Promise<void> {
  if (digest?.trim()) {
    await client.query(
      `UPDATE expression_indexes
       SET status = 'stale', dirty_member_ids = NULL
       WHERE digest = $1 AND status = 'ready'`,
      [digest.trim()],
    );
    return;
  }
  await client.query(
    `UPDATE expression_indexes
     SET status = 'stale', dirty_member_ids = NULL
     WHERE status = 'ready'`,
  );
}

export async function markExpressionIndexesStaleForTypes(
  client: Client,
  types: readonly string[],
  dirtyMemberIds?: readonly string[],
): Promise<void> {
  const typeSet = new Set(types.map((t) => t.trim()).filter((t) => t.length > 0));
  if (typeSet.size === 0) return;

  const result = await client.query<{
    digest: string;
    expression_json: unknown;
    dirty_member_ids: unknown;
  }>(
    `SELECT digest, expression_json, dirty_member_ids
     FROM expression_indexes WHERE status = 'ready'`,
  );

  const dirtyProvided = dirtyMemberIds !== undefined;
  const incomingDirty = dirtyProvided
    ? [
        ...new Set(
          dirtyMemberIds
            .map((id) => id.trim())
            .filter((id) => id.length > 0),
        ),
      ]
    : null;

  for (const row of result.rows) {
    const reachTypes = reachTypesFromExpressionJson(row.expression_json);
    const matches =
      reachTypes == null ||
      reachTypes.length === 0 ||
      reachTypes.some((t) => typeSet.has(t));
    if (!matches) continue;

    let dirtyJson: string | null = null;
    if (dirtyProvided && incomingDirty) {
      const prior = new Set<string>();
      const priorIds = asStringArray(row.dirty_member_ids);
      if (priorIds) {
        for (const id of priorIds) prior.add(id.trim());
      }
      for (const id of incomingDirty) prior.add(id);
      dirtyJson = JSON.stringify([...prior]);
    }

    await client.query(
      `UPDATE expression_indexes
       SET status = 'stale', dirty_member_ids = $1::jsonb
       WHERE digest = $2`,
      [dirtyJson, row.digest],
    );
  }
}
