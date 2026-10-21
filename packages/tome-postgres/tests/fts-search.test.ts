import { describe, expect, test } from "bun:test";
import { Client } from "pg";
import { relationshipType } from "tome-imp-postgres";
import {
  buildPostgresTsQuery,
  openPostgresFtsSearch,
  openPostgresGraphStore,
  resolvePostgresConnectionString,
} from "../src/index";

const POSTGRES_URI = process.env.POSTGRES_URI?.trim();

async function canConnect(): Promise<boolean> {
  if (!POSTGRES_URI) return false;
  try {
    const store = await openPostgresGraphStore({
      connectionString: resolvePostgresConnectionString(),
      clean: true,
    });
    await store.close();
    return true;
  } catch {
    return false;
  }
}

const live = await canConnect();

describe("buildPostgresTsQuery", () => {
  test("phrases with prefix on last token", () => {
    expect(buildPostgresTsQuery("  hello world  ")).toBe("hello & world:*");
    expect(buildPostgresTsQuery("dragon")).toBe("dragon:*");
    expect(buildPostgresTsQuery("   ")).toBeNull();
  });
});

describe.skipIf(!live)("tome-postgres FTS (Q3)", () => {
  test("ranked hits, filters, window, archive, preview", async () => {
    const connectionString = resolvePostgresConnectionString();
    const store = await openPostgresGraphStore({
      connectionString,
      clean: true,
    });
    const ftsClient = new Client({ connectionString });
    await ftsClient.connect();
    const isaAssociation = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const isaMember = relationshipType(isaAssociation, 0);
    const backend = openPostgresFtsSearch(ftsClient, {
      memberPerspectives: () => [isaMember],
    });

    try {
      expect(backend.syncEndpoint).toBeUndefined();

      await store.upsertNode(
        { id: "n1", properties: { title: "Dragon Quest" } },
        "an adventure about dragons",
      );
      await store.upsertNode(
        { id: "n2", properties: { title: "Quiet Lake" } },
        "no dragons here",
      );
      await store.upsertNode(
        { id: "n3", properties: { title: "Unrelated" } },
        "something else",
      );
      await store.upsertNode(
        { id: "typeFeature", properties: { title: "Feature" } },
      );
      await store.upsertNode(
        { id: "typeOther", properties: { title: "Other" } },
      );
      await store.upsertNode(
        { id: "a", properties: { title: "Alpha Mark" } },
        "mark body",
      );
      await store.upsertNode(
        { id: "b", properties: { title: "Beta Mark" } },
        "mark body",
      );

      await store.upsertRelationshipRecord({
        a: "a",
        b: "typeFeature",
        type: isaAssociation,
        properties: {},
      });
      await store.upsertRelationshipRecord({
        a: "b",
        b: "typeOther",
        type: isaAssociation,
        properties: {},
      });

      const hits = await backend.search.search({ query: "dragon", limit: 10 });
      expect(hits.map((h) => h.id)).toContain("n1");
      expect(hits.map((h) => h.id)).toContain("n2");
      expect(hits.map((h) => h.id)).not.toContain("n3");
      const n1 = hits.find((h) => h.id === "n1");
      expect(n1?.matchPreview).toBeDefined();

      const multi = await backend.search.search({
        query: "adventure dragon",
        limit: 10,
      });
      expect(multi.map((h) => h.id)).toContain("n1");

      const typed = await backend.search.search({
        query: "Mark",
        limit: 10,
        allowedTypeIds: ["typeFeature"],
      });
      expect(typed.map((h) => h.id)).toEqual(["a"]);

      const scoped = await backend.search.search({
        query: "Mark",
        limit: 10,
        allowedNodeIds: new Set(["a"]),
      });
      expect(scoped.map((h) => h.id)).toEqual(["a"]);

      const emptyScope = await backend.search.search({
        query: "Mark",
        limit: 10,
        allowedNodeIds: new Set(),
      });
      expect(emptyScope).toEqual([]);

      const window = await backend.search.searchWindow({
        query: "Mark",
        limit: 1,
        offset: 0,
      });
      expect(window.total).toBe(2);
      expect(window.hits).toHaveLength(1);

      const uncapped = await backend.search.searchWindow({
        query: "Mark",
        limit: null,
      });
      expect(uncapped.hits).toHaveLength(2);

      await store.archiveNodeFile("n1");
      const afterArchive = await backend.search.search({
        query: "dragon",
        limit: 10,
      });
      expect(afterArchive.map((h) => h.id)).not.toContain("n1");
      expect(afterArchive.map((h) => h.id)).toContain("n2");

      await store.unarchiveNodeFile("n1");
      const afterUnarchive = await backend.search.search({
        query: "dragon",
        limit: 10,
      });
      expect(afterUnarchive.map((h) => h.id)).toContain("n1");

      await store.upsertNode(
        { id: "n3", properties: { title: "Now Dragons" } },
        "updated with dragon token",
      );
      const afterUpdate = await backend.search.search({
        query: "dragon",
        limit: 10,
      });
      expect(afterUpdate.map((h) => h.id)).toContain("n3");
    } finally {
      backend.close();
      await ftsClient.end();
      await store.close();
    }
  });
});
