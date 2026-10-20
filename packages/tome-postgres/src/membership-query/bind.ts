import type {
  BoundExpr,
  ExprCatalog,
  MembershipQueryIntent,
} from "tome-sql";
import {
  MEMBER_ID_TOKEN,
  MEMBER_ROW_TOKEN,
  isSafeProjectionType,
  isSafeRelationFieldColumn,
  isSafeSqlPropertyKey,
  substituteTokens,
} from "tome-sql";

export const MEMBER_DISPLAY_TITLE_SQL = `COALESCE(NULLIF(n.properties->>'title', ''), NULLIF(n.properties->>'alias', ''), 'Untitled')`;

const RELATION_LINK_TITLE_SQL = MEMBER_DISPLAY_TITLE_SQL;

/** Numeric/text edge columns from jsonb properties (aliases match SQLite promoted cols). */
export function edgePropertyOrderExpression(propertyKey: string): string {
  if (propertyKey === "ordinal") {
    return `(NULLIF(${MEMBER_ROW_TOKEN}.properties->>'ordinal', ''))::numeric`;
  }
  if (propertyKey === "order") {
    return `${MEMBER_ROW_TOKEN}.properties->>'order'`;
  }
  if (propertyKey === "priority") {
    return `(NULLIF(${MEMBER_ROW_TOKEN}.properties->>'priority', ''))::numeric`;
  }
  return `${MEMBER_ROW_TOKEN}.properties->>'${propertyKey}'`;
}

export function memberEdgeOrderExpr(
  propertyKey: string,
  memberAlias: string,
): string {
  return substituteTokens(
    edgePropertyOrderExpression(propertyKey),
    `${memberAlias}.member_id`,
    memberAlias,
  );
}

function relationLinksSubquerySql(
  memberIdExpr: string,
  typePlaceholders: string,
  options?: { compositeTypeParam?: boolean },
): string {
  const compositeJoin = options?.compositeTypeParam
    ? `INNER JOIN relationship_records r ON r.id = rp.record_id AND r.composite_type = ?`
    : "";
  return `(
    SELECT COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object('targetId', x.target_id, 'title', x.title)
          ORDER BY x.ord_nulls, x.ordinal_num ASC NULLS LAST, x.id ASC
        )::text
        FROM (
          SELECT rp.target_node_id AS target_id,
                 ${RELATION_LINK_TITLE_SQL} AS title,
                 rp.id,
                 CASE WHEN rp.properties->>'ordinal' IS NULL OR rp.properties->>'ordinal' = ''
                      THEN 1 ELSE 0 END AS ord_nulls,
                 (NULLIF(rp.properties->>'ordinal', ''))::numeric AS ordinal_num
          FROM relationship_projections rp
          ${compositeJoin}
          LEFT JOIN nodes n ON n.id = rp.target_node_id
          WHERE rp.source_node_id = ${memberIdExpr}
            AND rp.type IN (${typePlaceholders})
        ) AS x
      ),
      '[]'
    )
  )`;
}

function relationFieldExistsSql(
  memberIdExpr: string,
  typePlaceholders: string,
): string {
  return `EXISTS (
    SELECT 1
    FROM relationship_projections rp
    INNER JOIN relationship_records r ON r.id = rp.record_id AND r.composite_type = ?
    WHERE rp.source_node_id = ${memberIdExpr}
      AND rp.type IN (${typePlaceholders})
  )`;
}

/**
 * Lower Intent sort keys and relation display fields into a Postgres expression catalog.
 */
export function bindExpressions(intent: MembershipQueryIntent): ExprCatalog {
  const sorts = new Map<string, BoundExpr>();

  for (const sort of intent.sorts) {
    const col = sort.column.trim();
    if (!col) continue;
    if (col === "name") {
      if (!isSafeSqlPropertyKey(col)) continue;
      sorts.set(col, {
        sql: `LOWER(${MEMBER_DISPLAY_TITLE_SQL})`,
        params: [],
      });
      continue;
    }
    if (!isSafeSqlPropertyKey(col)) continue;

    const exprEntry = intent.expressionIndexSorts.find((r) => r.column === col);
    if (exprEntry && /^[a-f0-9]{16,64}$/i.test(exprEntry.digest.trim())) {
      sorts.set(col, {
        sql: `COALESCE((SELECT eiv.sort_value FROM expression_index_values eiv WHERE eiv.digest = ? AND eiv.member_id = ${MEMBER_ID_TOKEN}), 0)`,
        params: [exprEntry.digest.trim()],
      });
      continue;
    }

    const relationEntry = intent.relationCounts.find((r) => r.column === col);
    if (relationEntry) {
      const safeTypes = relationEntry.projectionTypes.filter(
        (t) => typeof t === "string" && isSafeProjectionType(t),
      );
      if (safeTypes.length === 0) continue;
      const placeholders = safeTypes.map(() => "?").join(", ");
      sorts.set(col, {
        sql: `(SELECT COUNT(*) FROM relationship_projections rcount WHERE rcount.source_node_id = ${MEMBER_ID_TOKEN} AND rcount.type IN (${placeholders}))`,
        params: safeTypes.map((t) => t.trim()),
      });
      continue;
    }

    sorts.set(col, {
      sql: edgePropertyOrderExpression(col),
      params: [],
    });
  }

  const displays: ExprCatalog["displays"] = [];
  let aliasIndex = 0;
  for (const field of intent.relationFields) {
    const column = field.column.trim();
    if (!column || !isSafeRelationFieldColumn(column)) continue;
    const safeTypes = field.projectionTypes
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && isSafeProjectionType(t));
    if (safeTypes.length === 0) continue;
    const placeholders = safeTypes.map(() => "?").join(", ");
    const alias = `rf_${aliasIndex}`;
    aliasIndex += 1;

    const memberIdExpr = MEMBER_ID_TOKEN;
    const compositeType = field.compositeType?.trim();
    if (compositeType && isSafeProjectionType(compositeType)) {
      const compositeSub = relationLinksSubquerySql(memberIdExpr, placeholders, {
        compositeTypeParam: true,
      });
      const plainSub = relationLinksSubquerySql(memberIdExpr, placeholders);
      const existsSql = relationFieldExistsSql(memberIdExpr, placeholders);
      displays.push({
        column,
        alias,
        sql: `CASE WHEN ${existsSql} THEN ${compositeSub} ELSE ${plainSub} END`,
        params: [
          compositeType,
          ...safeTypes,
          compositeType,
          ...safeTypes,
          ...safeTypes,
        ],
      });
    } else {
      displays.push({
        column,
        alias,
        sql: relationLinksSubquerySql(memberIdExpr, placeholders),
        params: [...safeTypes],
      });
    }
  }

  return {
    sorts,
    displays,
    titleExpr: MEMBER_DISPLAY_TITLE_SQL,
    edgeOrderExpr: memberEdgeOrderExpr,
  };
}
