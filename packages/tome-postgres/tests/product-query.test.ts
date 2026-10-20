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

describe.skipIf(!live)("tome-postgres product query (Q1)", () => {
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

  test("expression-index sort refuses clearly", async () => {
    const mod = createPostgresModule();
    const cache = await mod.open({ clean: true });
    try {
      await cache.upsertNode("set1", { title: "Set" });
      await cache.upsertNode("m1", { title: "M" });
      await cache.upsertRelationship("set1", "m1", "member:0", {});

      await expect(
        cache.listMemberPage("set1", {
          projections: [
            { setProjection: "member:0", memberProjection: "member:1" },
          ],
          sorts: [{ column: "dynCol", direction: "asc" }],
          expressionIndexSorts: [
            {
              column: "dynCol",
              digest: "abcdef0123456789abcdef0123456789",
            },
          ],
        }),
      ).rejects.toThrow(/expression-index sort/);
    } finally {
      await cache.close();
    }
  });
});
