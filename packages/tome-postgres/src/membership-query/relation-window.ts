import { isSafeSqlPropertyKey } from "tome-sql";
import { MEMBER_DISPLAY_TITLE_SQL } from "./bind";

const TARGET_DISPLAY_TITLE_SQL = MEMBER_DISPLAY_TITLE_SQL;

function edgePropertyOrderExpression(propertyKey: string): string {
  if (propertyKey === "ordinal") {
    return `(NULLIF(rp.properties->>'ordinal', ''))::numeric`;
  }
  if (propertyKey === "order") {
    return `rp.properties->>'order'`;
  }
  if (propertyKey === "priority") {
    return `(NULLIF(rp.properties->>'priority', ''))::numeric`;
  }
  return `rp.properties->>'${propertyKey}'`;
}

export function buildOutgoingProjectionOrderBy(
  sorts: readonly { column: string; direction: "asc" | "desc" }[] | undefined,
): { orderBy: string; needsTargetJoin: boolean } {
  const clauses: string[] = [];
  if (sorts && sorts.length > 0) {
    for (const sort of sorts) {
      const dir = sort.direction === "desc" ? "DESC" : "ASC";
      const col = sort.column.trim();
      if (!col || !isSafeSqlPropertyKey(col)) continue;
      if (col === "name") {
        clauses.push(`LOWER(${TARGET_DISPLAY_TITLE_SQL}) ${dir}`);
      } else {
        clauses.push(`${edgePropertyOrderExpression(col)} ${dir} NULLS LAST`);
      }
    }
  }
  if (clauses.length === 0) {
    clauses.push(
      `(NULLIF(rp.properties->>'ordinal', ''))::numeric ASC NULLS LAST`,
    );
    clauses.push("rp.id ASC");
    return { orderBy: `ORDER BY ${clauses.join(", ")}`, needsTargetJoin: false };
  }
  clauses.push(`LOWER(${TARGET_DISPLAY_TITLE_SQL}) ASC`);
  clauses.push("rp.id ASC");
  return { orderBy: `ORDER BY ${clauses.join(", ")}`, needsTargetJoin: true };
}
