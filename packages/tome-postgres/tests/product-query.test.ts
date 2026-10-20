import { describe, expect, test } from "bun:test";
import { createPostgresModule } from "../src/index";

const POSTGRES_URI = process.env.POSTGRES_URI?.trim();

async function canConnect(): Promise<boolean> {
  if (!POSTGRES_URI) return false;
  try {
    const mod = createPostgresModule();
    const cache = await mod.open({ clean: true });
    await cache.close();
    return true;
  } catch {
    return false;
  }
}

const live = await canConnect();

describe.skipIf(!live)("tome-postgres product query (Q2)", () => {
  test("listMemberPage total, limit/offset, and title sort", async () => {
    const mod = createPostgresModule();
    const cache = await mod.open({ clean: true });
    try {
      await cache.upsertNode("set1", { title: "Set" });
      await cache.upsertNode("m1", { title: "Charlie" });
      await cache.upsertNode("m2", { title: "Alice" });
      await cache.upsertNode("m3", { title: "Bob" });

      await cache.upsertRelationship("set1", "m1", "member:0", { order: "3" });
      await cache.upsertRelationship("set1", "m2", "member:0", { order: "1" });
      await cache.upsertRelationship("set1", "m3", "member:0", { order: "2" });

      const page = await cache.listMemberPage("set1", {
        projections: [
          { setProjection: "member:0", memberProjection: "member:1" },
        ],
        sorts: [{ column: "name", direction: "asc" }],
        limit: 2,
        offset: 0,
      });

      expect(page.total).toBe(3);
      expect(page.relationships).toHaveLength(2);
      expect(page.relationships.map((r) => r.sourceNodeId)).toEqual([
        "m2",
        "m3",
      ]);

      const page2 = await cache.listMemberPage("set1", {
        projections: [
          { setProjection: "member:0", memberProjection: "member:1" },
        ],
        sorts: [{ column: "name", direction: "asc" }],
        limit: 2,
        offset: 2,
      });
      expect(page2.relationships.map((r) => r.sourceNodeId)).toEqual(["m1"]);
    } finally {
      await cache.close();
    }
  });

  test("scope filter and listMemberPageNodeIds", async () => {
    const mod = createPostgresModule();
    const cache = await mod.open({ clean: true });
    try {
      await cache.upsertNode("set1", { title: "Set" });
      await cache.upsertNode("scopeA", { title: "Scope A" });
      await cache.upsertNode("m1", { title: "In" });
      await cache.upsertNode("m2", { title: "Out" });

      await cache.upsertRelationship("set1", "m1", "member:0", {});
      await cache.upsertRelationship("set1", "m2", "member:0", {});
      await cache.upsertRelationship("m1", "scopeA", "scope:0", {});

      const ids = await cache.listMemberPageNodeIds("set1", {
        projections: [
          { setProjection: "member:0", memberProjection: "member:1" },
        ],
        scope: { projectionType: "scope:0", scopeNodeId: "scopeA" },
      });
      expect(ids.sort()).toEqual(["m1"]);

      const page = await cache.listMemberPage("set1", {
        projections: [
          { setProjection: "member:0", memberProjection: "member:1" },
        ],
        scope: { projectionType: "scope:0", scopeNodeId: "scopeA" },
      });
      expect(page.total).toBe(1);
      expect(page.relationships[0]?.sourceNodeId).toBe("m1");
    } finally {
      await cache.close();
    }
  });

  test("relation window and hydrate by target ids", async () => {
    const mod = createPostgresModule();
    const cache = await mod.open({ clean: true });
    try {
      await cache.upsertNode("src", { title: "Source" });
      await cache.upsertNode("t1", { title: "Zed" });
      await cache.upsertNode("t2", { title: "Amy" });
      await cache.upsertNode("t3", { title: "Mia" });

      await cache.upsertRelationship("src", "t1", "link:0", { ordinal: 2 });
      await cache.upsertRelationship("src", "t2", "link:0", { ordinal: 1 });
      await cache.upsertRelationship("src", "t3", "link:0", { ordinal: 3 });

      const window = await cache.listRelationshipsFromSourceWindow(
        "src",
        "link:0",
        { limit: 2, offset: 0 },
      );
      expect(window.total).toBe(3);
      expect(window.relationships.map((r) => r.targetNodeId)).toEqual([
        "t2",
        "t1",
      ]);

      const hydrated = await cache.listRelationshipsFromSourceForTargetIds(
        "src",
        "link:0",
        ["t3", "t1"],
      );
      expect(hydrated.map((r) => r.targetNodeId).sort()).toEqual(["t1", "t3"]);

      const targets = await cache.listRelatedTargetNodeIds("src", "link:0");
      expect(targets.sort()).toEqual(["t1", "t2", "t3"]);
    } finally {
      await cache.close();
    }
  });

  test("listDistinctSetMemberScopeIds and listComposedGroupHeaders smoke", async () => {
    const mod = createPostgresModule();
    const cache = await mod.open({ clean: true });
    try {
      await cache.upsertNode("set1", { title: "Set" });
      await cache.upsertNode("groupSet", { title: "Groups" });
      await cache.upsertNode("g1", { title: "Group One" });
      await cache.upsertNode("scopeA", { title: "Scope" });
      await cache.upsertNode("m1", { title: "Member" });

      await cache.upsertRelationship("set1", "m1", "member:0", {});
      await cache.upsertRelationship("m1", "scopeA", "scope:0", {});
      await cache.upsertRelationship("groupSet", "g1", "gset:0", { order: "1" });
      await cache.upsertRelationship("m1", "g1", "ingroup:0", {});

      const scopes = await cache.listDistinctSetMemberScopeIds("set1", {
        projections: [
          { setProjection: "member:0", memberProjection: "member:1" },
        ],
        scopeProjectionType: "scope:0",
      });
      expect(scopes.map((s) => s.id)).toEqual(["scopeA"]);

      const headers = await cache.listComposedGroupHeaders({
        groupTypeDatabaseId: "groupSet",
        groupSetProjections: [
          { setProjection: "gset:0", memberProjection: "gset:1" },
        ],
      });
      expect(headers.map((h) => h.id)).toEqual(["g1"]);
      expect(headers[0]?.title).toBe("Group One");
    } finally {
      await cache.close();
    }
  });

  test("expression-index sort orders by digest values", async () => {
    const mod = createPostgresModule();
    const cache = await mod.open({ clean: true });
    try {
      await cache.upsertNode("set1", { title: "Set" });
      await cache.upsertNode("m1", { title: "One" });
      await cache.upsertNode("m2", { title: "Two" });
      await cache.upsertNode("m3", { title: "Three" });
      await cache.upsertRelationship("set1", "m1", "member:0", {});
      await cache.upsertRelationship("set1", "m2", "member:0", {});
      await cache.upsertRelationship("set1", "m3", "member:0", {});

      const digest = "abcdef0123456789abcdef0123456789";
      await cache.replaceExpressionIndexValues(digest, "{}", [
        { memberId: "m1", sortValue: 10 },
        { memberId: "m2", sortValue: 50 },
        { memberId: "m3", sortValue: 1 },
      ]);
      expect(await cache.getExpressionIndexStatus(digest)).toBe("ready");

      const page = await cache.listMemberPage("set1", {
        projections: [
          { setProjection: "member:0", memberProjection: "member:1" },
        ],
        sorts: [{ column: "dynCol", direction: "desc" }],
        expressionIndexSorts: [{ column: "dynCol", digest }],
        limit: 2,
        offset: 0,
      });
      expect(page.relationships.map((r) => r.sourceNodeId)).toEqual([
        "m2",
        "m1",
      ]);

      await cache.upsertRelationship("set1", "m3", "member:0", { order: "9" });
      expect(await cache.getExpressionIndexStatus(digest)).toBe("stale");
    } finally {
      await cache.close();
    }
  });

  test("marks only digests whose reachTypes intersect the mutated type", async () => {
    const mod = createPostgresModule();
    const cache = await mod.open({ clean: true });
    try {
      const digestA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const digestB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      await cache.replaceExpressionIndexValues(
        digestA,
        JSON.stringify({ reachTypes: ["typeA", "assocSet:0"] }),
        [{ memberId: "m1", sortValue: 1 }],
      );
      await cache.replaceExpressionIndexValues(
        digestB,
        JSON.stringify({ reachTypes: ["typeB"] }),
        [{ memberId: "m1", sortValue: 2 }],
      );
      expect(await cache.getExpressionIndexStatus(digestA)).toBe("ready");
      expect(await cache.getExpressionIndexStatus(digestB)).toBe("ready");

      await cache.markExpressionIndexesStaleForTypes(["typeA"], ["m1", "other"]);
      expect(await cache.getExpressionIndexStatus(digestA)).toBe("stale");
      expect(await cache.getExpressionIndexStatus(digestB)).toBe("ready");
      expect(
        (await cache.getExpressionIndexDirtyMemberIds(digestA))?.sort(),
      ).toEqual(["m1", "other"]);
      expect(await cache.getExpressionIndexDirtyMemberIds(digestB)).toBeNull();
    } finally {
      await cache.close();
    }
  });

  test("upserts expression index values without wiping siblings", async () => {
    const mod = createPostgresModule();
    const cache = await mod.open({ clean: true });
    try {
      const digest = "cccccccccccccccccccccccccccccccc";
      await cache.replaceExpressionIndexValues(
        digest,
        JSON.stringify({ reachTypes: ["t"] }),
        [
          { memberId: "m1", sortValue: 10 },
          { memberId: "m2", sortValue: 50 },
        ],
      );
      await cache.markExpressionIndexesStaleForTypes(["t"], ["m1"]);
      expect(await cache.getExpressionIndexStatus(digest)).toBe("stale");

      await cache.upsertExpressionIndexValues(
        digest,
        JSON.stringify({ reachTypes: ["t"] }),
        [{ memberId: "m1", sortValue: 99 }],
      );
      expect(await cache.getExpressionIndexStatus(digest)).toBe("ready");
      expect(await cache.getExpressionIndexDirtyMemberIds(digest)).toBeNull();

      const rows = await cache.queryAll<{
        member_id: string;
        sort_value: number;
      }>(
        "SELECT member_id, sort_value FROM expression_index_values WHERE digest = $1 ORDER BY member_id",
        digest,
      );
      expect(rows).toEqual([
        { member_id: "m1", sort_value: 99 },
        { member_id: "m2", sort_value: 50 },
      ]);

      await cache.deleteExpressionIndexValues(digest, ["m2"]);
      const afterDelete = await cache.queryAll<{ member_id: string }>(
        "SELECT member_id FROM expression_index_values WHERE digest = $1",
        digest,
      );
      expect(afterDelete).toEqual([{ member_id: "m1" }]);
    } finally {
      await cache.close();
    }
  });

  test("global markExpressionIndexesStale clears dirty_member_ids", async () => {
    const mod = createPostgresModule();
    const cache = await mod.open({ clean: true });
    try {
      const digest = "dddddddddddddddddddddddddddddddd";
      await cache.replaceExpressionIndexValues(
        digest,
        JSON.stringify({ reachTypes: ["t"] }),
        [{ memberId: "m1", sortValue: 1 }],
      );
      await cache.markExpressionIndexesStaleForTypes(["t"], ["m1"]);
      expect(await cache.getExpressionIndexDirtyMemberIds(digest)).toEqual([
        "m1",
      ]);

      await cache.upsertExpressionIndexValues(
        digest,
        JSON.stringify({ reachTypes: ["t"] }),
        [{ memberId: "m1", sortValue: 2 }],
      );
      await cache.markExpressionIndexesStale();
      expect(await cache.getExpressionIndexStatus(digest)).toBe("stale");
      expect(await cache.getExpressionIndexDirtyMemberIds(digest)).toBeNull();
    } finally {
      await cache.close();
    }
  });
});
