import type { SqlParam } from "tome-sql";

/**
 * Rewrite `?` placeholders to Postgres `$1…$n` in left-to-right order.
 * Generated membership SQL never embeds `?` inside string literals.
 */
export function toPostgresSql(
  sql: string,
  params: readonly SqlParam[],
): { sql: string; params: unknown[] } {
  let index = 0;
  const out = sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
  if (index !== params.length) {
    throw new Error(
      `tome-postgres membership SQL: expected ${params.length} params, found ${index} placeholders`,
    );
  }
  return { sql: out, params: [...params] };
}
