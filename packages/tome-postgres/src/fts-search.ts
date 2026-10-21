import type { Client } from "pg";
import type {
  TomeSearch,
  TomeSearchBackend,
  TomeSearchRequest,
  TomeSearchWindowRequest,
  TomeSearchWindowResult,
} from "tome-interfaces/search";
import {
  isEmptyAllowedNodeIds,
  mapSearchHitsWithPreview,
  resolveSearchWindowBounds,
} from "tome-interfaces/search";

const DISPLAY_TITLE_SQL = `COALESCE(
  NULLIF(properties->>'title', ''),
  NULLIF(properties->>'alias', ''),
  'Untitled'
)`;

export type OpenPostgresFtsSearchOptions = {
  /**
   * Projection types used as "member" sides for `allowedTypeIds`
   * (EXISTS on relationship_projections). Empty → type filter matches nothing.
   */
  memberPerspectives?: () => readonly string[];
};

/**
 * Build a Postgres `to_tsquery('english', …)` string: AND of lexemes with
 * prefix match (`:*`) on the last token. Returns null for empty/unusable input.
 */
export function buildPostgresTsQuery(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const tokens = trimmed
    .split(/\s+/)
    .map((t) => t.replace(/['\\:&|!()<>]/g, ""))
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens
    .map((token, index) =>
      index === tokens.length - 1 ? `${token}:*` : token,
    )
    .join(" & ");
}

/** Append values to `params`; placeholders are 1-based indexes into the final param list. */
function pushInList(params: unknown[], values: readonly string[]): string {
  const placeholders: string[] = [];
  for (const value of values) {
    params.push(value);
    placeholders.push(`$${params.length}`);
  }
  return placeholders.join(", ");
}

/**
 * Build filter SQL. `params` must already contain the leading tsquery (`$1`)
 * so IN-list placeholders stay aligned with the final argument list.
 */
function appendFilters(
  params: unknown[],
  allowedTypeIds: readonly string[] | undefined,
  allowedNodeIds: ReadonlySet<string> | undefined,
  memberPerspectives: readonly string[],
): string {
  const parts: string[] = [];

  if (allowedNodeIds && allowedNodeIds.size > 0) {
    const inList = pushInList(params, [...allowedNodeIds]);
    parts.push(`AND id IN (${inList})`);
  }

  if (allowedTypeIds && allowedTypeIds.length > 0) {
    if (memberPerspectives.length === 0) {
      parts.push("AND FALSE");
    } else {
      const perspectiveList = pushInList(params, memberPerspectives);
      const typeList = pushInList(params, allowedTypeIds);
      parts.push(`AND EXISTS (
        SELECT 1 FROM relationship_projections rp
        WHERE rp.source_node_id = nodes.id
          AND rp.type IN (${perspectiveList})
          AND rp.target_node_id IN (${typeList})
      )`);
    }
  }

  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

export function createPostgresFtsSearch(
  client: Client,
  options: OpenPostgresFtsSearchOptions = {},
): TomeSearch {
  const resolvePerspectives = () => options.memberPerspectives?.() ?? [];

  return {
    async search(request: TomeSearchRequest) {
      const { query, limit, allowedTypeIds, allowedNodeIds } = request;
      if (isEmptyAllowedNodeIds(allowedNodeIds)) return [];

      const tsQuery = buildPostgresTsQuery(query);
      if (!tsQuery) return [];

      const cap = Math.max(1, Math.min(limit, 100));
      const params: unknown[] = [tsQuery];
      const filterSql = appendFilters(
        params,
        allowedTypeIds,
        allowedNodeIds,
        resolvePerspectives(),
      );
      params.push(cap);
      const limitParam = params.length;

      const result = await client.query<{
        id: string;
        title: string;
        body: string | null;
      }>(
        `SELECT id,
                ${DISPLAY_TITLE_SQL} AS title,
                body
         FROM nodes
         WHERE search_vector @@ to_tsquery('english', $1)
           AND NOT is_archived
           ${filterSql}
         ORDER BY ts_rank_cd(search_vector, to_tsquery('english', $1)) DESC, id
         LIMIT $${limitParam}`,
        params,
      );

      return mapSearchHitsWithPreview(result.rows, query);
    },

    async searchWindow(
      request: TomeSearchWindowRequest,
    ): Promise<TomeSearchWindowResult> {
      const { query, allowedTypeIds, allowedNodeIds } = request;
      if (isEmptyAllowedNodeIds(allowedNodeIds)) {
        return { hits: [], total: 0 };
      }

      const tsQuery = buildPostgresTsQuery(query);
      if (!tsQuery) return { hits: [], total: 0 };

      const { offset, limit } = resolveSearchWindowBounds(request);
      const baseParams: unknown[] = [tsQuery];
      const filterSql = appendFilters(
        baseParams,
        allowedTypeIds,
        allowedNodeIds,
        resolvePerspectives(),
      );

      const countResult = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM nodes
         WHERE search_vector @@ to_tsquery('english', $1)
           AND NOT is_archived
           ${filterSql}`,
        baseParams,
      );
      const total = Number(countResult.rows[0]?.c ?? 0);

      if (total === 0 || offset >= total) {
        return { hits: [], total };
      }

      const selectSql = `SELECT id,
                ${DISPLAY_TITLE_SQL} AS title,
                body
         FROM nodes
         WHERE search_vector @@ to_tsquery('english', $1)
           AND NOT is_archived
           ${filterSql}
         ORDER BY ts_rank_cd(search_vector, to_tsquery('english', $1)) DESC, id`;

      let rows: { id: string; title: string; body: string | null }[];
      if (limit === null) {
        if (offset === 0) {
          const result = await client.query<{
            id: string;
            title: string;
            body: string | null;
          }>(selectSql, baseParams);
          rows = result.rows;
        } else {
          const params = [...baseParams, offset];
          const result = await client.query<{
            id: string;
            title: string;
            body: string | null;
          }>(`${selectSql} OFFSET $${params.length}`, params);
          rows = result.rows;
        }
      } else {
        const params = [...baseParams, limit, offset];
        const result = await client.query<{
          id: string;
          title: string;
          body: string | null;
        }>(
          `${selectSql} LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        );
        rows = result.rows;
      }

      return { hits: mapSearchHitsWithPreview(rows, query), total };
    },
  };
}

/**
 * Open a same-DB Postgres FTS backend (no sync-fed indexing).
 * Does not take ownership of `client` — `close()` is a no-op.
 */
export function openPostgresFtsSearch(
  client: Client,
  options: OpenPostgresFtsSearchOptions = {},
): TomeSearchBackend {
  return {
    search: createPostgresFtsSearch(client, options),
    close() {
      /* client owned by caller */
    },
  };
}
