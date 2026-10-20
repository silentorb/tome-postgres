import type {
  EmittedSql,
  MembershipQueryPlan,
  SqlFragment,
  SqlParam,
} from "tome-sql";
import { substituteTokens } from "tome-sql";
import { toPostgresSql } from "./pg-params";

type MembershipCte = SqlFragment;

const PROJ_SELECT = `rp.id, rp.record_id, rp.type, rp.properties,
              (NULLIF(rp.properties->>'ordinal', ''))::numeric AS ordinal,
              rp.properties->>'order' AS "order",
              (NULLIF(rp.properties->>'priority', ''))::numeric AS priority`;

/** Membership union + dedupe CTE (also used by scope discovery / group headers). */
export function buildMembershipCte(
  setId: string,
  pairs: readonly { setProjection: string; memberProjection: string }[],
): MembershipCte | null {
  const unionParts: string[] = [];
  const unionParams: SqlParam[] = [];
  for (const pair of pairs) {
    const setProjection = pair.setProjection?.trim();
    const memberProjection = pair.memberProjection?.trim();
    if (!setProjection || !memberProjection) continue;
    unionParts.push(
      `SELECT ${PROJ_SELECT}, rp.target_node_id AS member_id, rp.source_node_id AS set_id,
              0 AS side_rank
       FROM relationship_projections rp
       WHERE rp.source_node_id = ? AND rp.type = ?`,
    );
    unionParams.push(setId, setProjection);
    unionParts.push(
      `SELECT ${PROJ_SELECT}, rp.source_node_id AS member_id, rp.target_node_id AS set_id,
              1 AS side_rank
       FROM relationship_projections rp
       WHERE rp.target_node_id = ? AND rp.type = ?`,
    );
    unionParams.push(setId, memberProjection);
  }
  if (unionParts.length === 0) return null;

  return {
    sql: `
      WITH membership AS (
        ${unionParts.join("\nUNION ALL\n")}
      ),
      ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY member_id ORDER BY side_rank ASC, id ASC) AS rn
        FROM membership
      ),
      members AS (
        SELECT id, record_id, member_id, set_id, type, properties, ordinal, "order", priority
        FROM ranked
        WHERE rn = 1
      )`,
    params: unionParams,
  };
}

function emptyEmitted(includeGroupId = false): EmittedSql {
  return {
    empty: true,
    withSql: "",
    withParams: [],
    countSql: "",
    countParams: [],
    pageSql: "",
    pageParams: [],
    relationColumns: [],
    includeGroupId,
    applyLimitOffset: false,
  };
}

function finalize(emitted: EmittedSql): EmittedSql {
  if (emitted.empty) return emitted;
  const count = emitted.countSql
    ? toPostgresSql(emitted.countSql, emitted.countParams)
    : { sql: "", params: [] as unknown[] };
  const page = toPostgresSql(emitted.pageSql, emitted.pageParams);
  const withPart = emitted.withSql
    ? toPostgresSql(emitted.withSql, emitted.withParams)
    : { sql: "", params: [] as unknown[] };
  return {
    ...emitted,
    withSql: withPart.sql,
    withParams: withPart.params,
    countSql: count.sql,
    countParams: count.params,
    pageSql: page.sql,
    pageParams: page.params,
  };
}

function appendScopeFilter(
  withSql: string,
  params: SqlParam[],
  scope: { projectionType: string; scopeNodeId: string } | undefined,
  forceIdentity: boolean,
): string {
  if (scope) {
    params.push(
      scope.projectionType,
      scope.scopeNodeId,
      scope.projectionType,
      scope.scopeNodeId,
    );
    return `${withSql},
      scoped_members AS (
        SELECT m.*
        FROM members m
        WHERE EXISTS (
          SELECT 1 FROM relationship_projections sp
          WHERE sp.source_node_id = m.member_id AND sp.type = ? AND sp.target_node_id = ?
        )
        OR EXISTS (
          SELECT 1 FROM relationship_projections sp
          WHERE sp.target_node_id = m.member_id AND sp.type = ? AND sp.source_node_id = ?
        )
      )`;
  }
  if (forceIdentity) {
    return `${withSql},
      scoped_members AS (SELECT * FROM members)`;
  }
  return withSql;
}

function appendGroupEnrichment(
  withSql: string,
  params: SqlParam[],
  groups: NonNullable<MembershipQueryPlan["intent"]["groups"]> | undefined,
): string {
  if (!groups) {
    return `${withSql},
      member_with_group AS (
        SELECT sm.*, CAST(NULL AS TEXT) AS group_id, CAST(NULL AS DOUBLE PRECISION) AS group_sort_key,
               CAST(NULL AS TEXT) AS group_title
        FROM scoped_members sm
      )`;
  }

  const memberToGroupType = groups.memberToGroupProjectionType;
  const groupTypeDatabaseId = groups.groupTypeDatabaseId;
  const groupToScopeType = groups.groupToScopeProjectionType?.trim();
  const groupScopeId = groups.scopeNodeId?.trim();
  const filterGroupScope = Boolean(groupToScopeType && groupScopeId);
  const canonical = groups.canonicalGroupByTitle !== false;
  const groupTitleSql = `COALESCE(NULLIF(gn.properties->>'title', ''), NULLIF(gn.properties->>'alias', ''), 'Untitled')`;

  const groupPairs = groups.groupSetProjections ?? [];
  const groupUnion: string[] = [];
  const groupParams: SqlParam[] = [];
  for (const pair of groupPairs) {
    const setProjection = pair.setProjection?.trim();
    const memberProjection = pair.memberProjection?.trim();
    if (!setProjection || !memberProjection) continue;
    groupUnion.push(
      `SELECT rp.target_node_id AS group_id, rp.properties->>'order' AS group_order, 0 AS side_rank, rp.id AS edge_id
           FROM relationship_projections rp
           WHERE rp.source_node_id = ? AND rp.type = ?`,
    );
    groupParams.push(groupTypeDatabaseId, setProjection);
    groupUnion.push(
      `SELECT rp.source_node_id AS group_id, rp.properties->>'order' AS group_order, 1 AS side_rank, rp.id AS edge_id
           FROM relationship_projections rp
           WHERE rp.target_node_id = ? AND rp.type = ?`,
    );
    groupParams.push(groupTypeDatabaseId, memberProjection);
  }

  if (groupUnion.length === 0) {
    return `${withSql},
      member_with_group AS (
        SELECT sm.*, CAST(NULL AS TEXT) AS group_id, CAST(NULL AS DOUBLE PRECISION) AS group_sort_key,
               CAST(NULL AS TEXT) AS group_title
        FROM scoped_members sm
      )`;
  }

  let sql = `${withSql},
      group_membership AS (
        ${groupUnion.join("\nUNION ALL\n")}
      ),
      group_ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY side_rank ASC, edge_id ASC) AS rn
        FROM group_membership
      ),
      group_headers AS (
        SELECT gr.group_id,
               COALESCE((NULLIF(gr.group_order, ''))::double precision, 999) AS sort_key,
               ${groupTitleSql} AS title
        FROM group_ranked gr
        LEFT JOIN nodes gn ON gn.id = gr.group_id
        WHERE gr.rn = 1`;
  params.push(...groupParams);

  if (filterGroupScope && groupToScopeType && groupScopeId) {
    sql += `
          AND (
            EXISTS (
              SELECT 1 FROM relationship_projections gsp
              WHERE gsp.source_node_id = gr.group_id AND gsp.type = ? AND gsp.target_node_id = ?
            )
            OR EXISTS (
              SELECT 1 FROM relationship_projections gsp
              WHERE gsp.target_node_id = gr.group_id AND gsp.type = ? AND gsp.source_node_id = ?
            )
          )`;
    params.push(groupToScopeType, groupScopeId, groupToScopeType, groupScopeId);
  }

  const nodeTitleKey = `lower(trim(
                   COALESCE(NULLIF(rn.properties->>'title', ''), NULLIF(rn.properties->>'alias', ''), 'Untitled')
                 ))`;

  const canonicalBranch = canonical
    ? `WHEN (
               SELECT cg.canonical_id FROM nodes rn
               INNER JOIN canonical_groups cg
                 ON cg.title_key = ${nodeTitleKey}
               WHERE rn.id = rmg.raw_group_id
               LIMIT 1
             ) IS NOT NULL
            THEN (
               SELECT cg.canonical_id FROM nodes rn
               INNER JOIN canonical_groups cg
                 ON cg.title_key = ${nodeTitleKey}
               WHERE rn.id = rmg.raw_group_id
               LIMIT 1
            )`
    : "";

  sql += `
      ),
      canonical_groups AS (
        SELECT title_key, group_id AS canonical_id
        FROM (
          SELECT lower(trim(title)) AS title_key, group_id,
            ROW_NUMBER() OVER (
              PARTITION BY lower(trim(title))
              ORDER BY sort_key ASC, lower(title) ASC, group_id ASC
            ) AS rn
          FROM group_headers
        ) ranked_titles WHERE rn = 1
      ),
      raw_member_group AS (
        SELECT sm.member_id,
          COALESCE(
            (
              SELECT sp.target_node_id FROM relationship_projections sp
              WHERE sp.source_node_id = sm.member_id AND sp.type = ?
              ORDER BY sp.id ASC LIMIT 1
            ),
            (
              SELECT sp.source_node_id FROM relationship_projections sp
              WHERE sp.target_node_id = sm.member_id AND sp.type = ?
              ORDER BY sp.id ASC LIMIT 1
            )
          ) AS raw_group_id
        FROM scoped_members sm
      ),
      resolved_member_group AS (
        SELECT rmg.member_id,
          CASE
            WHEN rmg.raw_group_id IS NULL THEN NULL
            WHEN EXISTS (SELECT 1 FROM group_headers gh WHERE gh.group_id = rmg.raw_group_id)
              THEN rmg.raw_group_id
            ${canonicalBranch}
            ELSE NULL
          END AS group_id
        FROM raw_member_group rmg
      ),
      member_with_group AS (
        SELECT sm.*,
               rmg.group_id AS group_id,
               gh.sort_key AS group_sort_key,
               gh.title AS group_title
        FROM scoped_members sm
        LEFT JOIN resolved_member_group rmg ON rmg.member_id = sm.member_id
        LEFT JOIN group_headers gh ON gh.group_id = rmg.group_id
      )`;
  params.push(memberToGroupType, memberToGroupType);
  return sql;
}

function buildOrderBy(
  plan: MembershipQueryPlan,
  memberRowAlias: string,
  memberIdExpr: string,
): SqlFragment {
  const clauses: string[] = [];
  const params: SqlParam[] = [];
  const { catalog, orderKeys } = plan;

  for (const key of orderKeys) {
    switch (key.kind) {
      case "groupPrefix":
        clauses.push(
          `CASE WHEN ${memberRowAlias}.group_id IS NULL THEN 1 ELSE 0 END ASC`,
        );
        clauses.push(`COALESCE(${memberRowAlias}.group_sort_key, 999) ASC`);
        clauses.push(
          `LOWER(COALESCE(${memberRowAlias}.group_title, '')) ASC`,
        );
        break;
      case "catalogSort": {
        const col = key.column?.trim() ?? "";
        const bound = catalog.sorts.get(col);
        if (!bound) break;
        const dir = key.direction === "desc" ? "DESC" : "ASC";
        const expr = substituteTokens(bound.sql, memberIdExpr, memberRowAlias);
        clauses.push(`${expr} ${dir} NULLS LAST`);
        params.push(...bound.params);
        break;
      }
      case "intrinsicSequence":
        clauses.push(
          `CASE WHEN ${memberRowAlias}."order" IS NULL THEN 1 ELSE 0 END ASC`,
        );
        clauses.push(
          `CAST(NULLIF(${memberRowAlias}."order", '') AS DOUBLE PRECISION) ASC NULLS LAST`,
        );
        break;
      case "title":
        clauses.push(`LOWER(${catalog.titleExpr}) ASC`);
        break;
      case "id":
        clauses.push(`${memberRowAlias}.id ASC`);
        break;
    }
  }

  return {
    sql: clauses.length > 0 ? `ORDER BY ${clauses.join(", ")}` : "",
    params,
  };
}

function displaySelectSql(
  plan: MembershipQueryPlan,
  memberIdExpr: string,
  memberRowAlias: string,
): SqlFragment & { columns: string[] } {
  const fragments: string[] = [];
  const params: SqlParam[] = [];
  const columns: string[] = [];
  for (const display of plan.catalog.displays) {
    const sql = substituteTokens(display.sql, memberIdExpr, memberRowAlias);
    fragments.push(`, ${sql} AS ${display.alias}`);
    params.push(...display.params);
    columns.push(display.column);
  }
  return { sql: fragments.join(""), params, columns };
}

function emitIdsSql(plan: MembershipQueryPlan): EmittedSql {
  const { intent } = plan;
  const membership = buildMembershipCte(intent.setId, intent.projections);
  if (!membership) {
    return emptyEmitted();
  }

  let withSql = membership.sql.trim();
  const withParams: SqlParam[] = [...membership.params];
  let fromRelation = "members";

  if (intent.scope) {
    withSql = appendScopeFilter(withSql, withParams, intent.scope, false);
    fromRelation = "scoped_members";
  }

  const pageSql = `${withSql} SELECT member_id AS id FROM ${fromRelation}`;
  return finalize({
    empty: false,
    withSql,
    withParams: [...withParams],
    countSql: "",
    countParams: [],
    pageSql,
    pageParams: [...withParams],
    relationColumns: [],
    includeGroupId: false,
    applyLimitOffset: false,
  });
}

/**
 * Emit count + page (or ids) statements from a membership query plan.
 */
export function emitMembershipSql(plan: MembershipQueryPlan): EmittedSql {
  const { intent, layers, includeGroupId } = plan;

  if (intent.memberIds && intent.memberIds.length === 0) {
    return emptyEmitted(includeGroupId);
  }

  if (intent.mode === "ids") {
    return emitIdsSql(plan);
  }

  const membership = buildMembershipCte(intent.setId, intent.projections);
  if (!membership) {
    return emptyEmitted();
  }

  const hasScope = layers.includes("scopeFilter");
  const hasGroups = layers.includes("groupEnrichment");
  const useEnrichedPath = hasScope || hasGroups;

  const withParams: SqlParam[] = [...membership.params];
  let withSql = membership.sql.trim();

  if (useEnrichedPath) {
    withSql = appendScopeFilter(withSql, withParams, intent.scope, true);
    withSql = appendGroupEnrichment(
      withSql,
      withParams,
      hasGroups ? intent.groups : undefined,
    );
  }

  const memberRowAlias = useEnrichedPath ? "mwg" : "m";
  const memberIdExpr = `${memberRowAlias}.member_id`;
  const fromRelation = useEnrichedPath ? "member_with_group" : "members";
  const fromAlias = useEnrichedPath
    ? "member_with_group mwg"
    : "members m";

  const applyLimitOffset = !(
    intent.memberIds && intent.memberIds.length > 0
  );

  const countSql = `${withSql} SELECT COUNT(*)::int AS c FROM ${fromRelation}`;
  const countParams = [...withParams];

  const displays = displaySelectSql(plan, memberIdExpr, memberRowAlias);
  const orderBy = buildOrderBy(plan, memberRowAlias, memberIdExpr);

  const filterMemberIds = Boolean(
    intent.memberIds && intent.memberIds.length > 0,
  );
  const memberIdPlaceholders = filterMemberIds
    ? intent.memberIds!.map(() => "?").join(", ")
    : "";

  const groupIdSelect = includeGroupId
    ? `,\n             ${memberRowAlias}.group_id AS resolved_group_id`
    : "";

  const pageSql = `${withSql}
      SELECT ${memberRowAlias}.id, ${memberRowAlias}.record_id, ${memberRowAlias}.member_id AS source_node_id, ${memberRowAlias}.set_id AS target_node_id,
             ${memberRowAlias}.type, ${memberRowAlias}.properties, ${memberRowAlias}.ordinal, ${memberRowAlias}."order", ${memberRowAlias}.priority${groupIdSelect}
             ${displays.sql}
      FROM ${fromAlias}
      LEFT JOIN nodes n ON n.id = ${memberRowAlias}.member_id
      ${filterMemberIds ? `WHERE ${memberRowAlias}.member_id IN (${memberIdPlaceholders})` : ""}
      ${orderBy.sql}`;

  const pageParams: SqlParam[] = [
    ...withParams,
    ...displays.params,
    ...(filterMemberIds ? [...intent.memberIds!] : []),
    ...orderBy.params,
  ];

  return finalize({
    empty: false,
    withSql,
    withParams: [...withParams],
    countSql,
    countParams,
    pageSql,
    pageParams,
    relationColumns: displays.columns,
    includeGroupId,
    applyLimitOffset,
  });
}
