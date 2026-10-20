import {
  withProfilingSpan,
  type ProfilingAttributes,
} from "tome-service-interfaces";
import {
  analyzeMemberPage,
  planMembershipQuery,
  type MemberPageQueryLike,
  type EmittedSql,
} from "tome-sql";
import { bindExpressions } from "./bind";
import { emitMembershipSql } from "./emit";

/**
 * Analyze → Bind → Plan → Emit for Postgres product member pages.
 */
export function compileMemberPage(
  setId: string,
  query: MemberPageQueryLike,
  mode?: "page" | "ids",
): EmittedSql {
  const resolvedMode = mode ?? query.mode ?? "page";
  const intent = withProfilingSpan(
    "memberPage.analyze",
    "INTERNAL",
    { "member.mode": resolvedMode },
    () =>
      analyzeMemberPage(setId, {
        ...query,
        mode: resolvedMode,
      }),
  );

  const baseAttrs: ProfilingAttributes = {
    "member.mode": resolvedMode,
    "member.has_member_ids": Boolean(
      intent.memberIds && intent.memberIds.length > 0,
    ),
    "member.has_relation_fields": intent.relationFields.length > 0,
    "member.has_scope": intent.scope != null,
    "member.has_groups": intent.groups != null,
  };

  const catalog = withProfilingSpan(
    "memberPage.bind",
    "INTERNAL",
    { ...baseAttrs },
    () => bindExpressions(intent),
  );

  const planAttrs: ProfilingAttributes = { ...baseAttrs };
  const plan = withProfilingSpan("memberPage.plan", "INTERNAL", planAttrs, () => {
    const next = planMembershipQuery(intent, catalog);
    planAttrs["member.layers"] = next.layers.join(",");
    planAttrs["member.order_kinds"] = next.orderKeys.map((k) => k.kind).join(",");
    return next;
  });

  const emitAttrs: ProfilingAttributes = {
    ...baseAttrs,
    "member.layers": planAttrs["member.layers"] ?? "",
    "member.order_kinds": planAttrs["member.order_kinds"] ?? "",
  };
  return withProfilingSpan("memberPage.emit", "INTERNAL", emitAttrs, () => {
    const emitted = emitMembershipSql(plan);
    emitAttrs["member.empty"] = emitted.empty;
    emitAttrs["member.apply_limit_offset"] = emitted.applyLimitOffset;
    return emitted;
  });
}
