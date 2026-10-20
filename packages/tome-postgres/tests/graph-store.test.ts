import { describe, expect, test } from "bun:test";
import type { Graph } from "imp-core-types";
import { relationshipType } from "tome-imp-postgres";
import {
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

describe.skipIf(!live)("tome-postgres graph store (Base B1)", () => {
  test("upserts nodes and relationship records with dual projections", async () => {
    const store = await openPostgresGraphStore({
      connectionString: resolvePostgresConnectionString(),
      clean: true,
    });
    try {
      expect(store.capabilities.queryable).toBe(true);
      if (store.capabilities.queryable) {
        expect(store.capabilities.impExecution).toBe("sql");
      }

      await store.upsertNode({ id: "a", properties: { title: "A" } });
      await store.upsertNode({ id: "b", properties: { title: "B" } });

      const association = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
      await store.upsertRelationshipRecord({
        a: "a",
        b: "b",
        type: association,
        properties: { via: "ab" },
      });

      const record = await store.getRelationshipRecord("a", "b", association);
      expect(record).toEqual({
        a: "a",
        b: "b",
        type: association,
        properties: { via: "ab" },
      });

      const fromA = await store.listRelationshipProjections("a");
      expect(fromA).toHaveLength(2);
      const types = fromA.map((r) => r.type).sort();
      expect(types).toEqual([
        relationshipType(association, 0),
        relationshipType(association, 1),
      ]);

      const ids = await store.listNodeIds();
      expect(ids).toEqual(["a", "b"]);
    } finally {
      await store.close();
    }
  });

  test("executeImp filter/limit and traverse against SoT", async () => {
    const store = await openPostgresGraphStore({
      connectionString: resolvePostgresConnectionString(),
      clean: true,
    });
    try {
      await store.upsertNode({
        id: "n1",
        properties: { status: "active", title: "One" },
      });
      await store.upsertNode({
        id: "n2",
        properties: { status: "inactive", title: "Two" },
      });
      await store.upsertNode({
        id: "n3",
        properties: { status: "active", title: "Three" },
      });

      const filterGraph: Graph = {
        nodes: {
          in: { id: "in", type: "input", inputs: {} },
          col: { id: "col", type: "column", inputs: { name: "status" } },
          lit: { id: "lit", type: "literal", inputs: { value: "active" } },
          eq: { id: "eq", type: "equals", inputs: {} },
          filter: { id: "filter", type: "filter", inputs: {} },
          limit: { id: "limit", type: "limit", inputs: { count: 5 } },
          out: { id: "out", type: "output", inputs: {} },
        },
        edges: {
          e_col: {
            from: { node: "col", port: "value" },
            to: { node: "eq", port: "left" },
          },
          e_lit: {
            from: { node: "lit", port: "value" },
            to: { node: "eq", port: "right" },
          },
          e_pred: {
            from: { node: "eq", port: "value" },
            to: { node: "filter", port: "predicate" },
          },
          e_in: {
            from: { node: "in", port: "value" },
            to: { node: "filter", port: "collection" },
          },
          e_filter: {
            from: { node: "filter", port: "collection" },
            to: { node: "limit", port: "collection" },
          },
          e_out: {
            from: { node: "limit", port: "collection" },
            to: { node: "out", port: "value" },
          },
        },
      };

      const filtered = await store.executeImp(filterGraph);
      expect(filtered.rows.map((r) => r.id).sort()).toEqual(["n1", "n3"]);

      const association = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
      await store.upsertNode({ id: "a", properties: { title: "A" } });
      await store.upsertNode({ id: "b", properties: { title: "B" } });
      await store.upsertNode({ id: "c", properties: { title: "C" } });
      await store.upsertRelationship(
        "a",
        "b",
        relationshipType(association, 0),
        { via: "ab" },
      );
      await store.upsertRelationship(
        "a",
        "c",
        relationshipType(association, 0),
        { via: "ac" },
      );

      const traverseGraph: Graph = {
        nodes: {
          in: { id: "in", type: "input", inputs: {} },
          hop: {
            id: "hop",
            type: "traverse",
            inputs: { association, direction: 0 },
          },
          out: { id: "out", type: "output", inputs: {} },
        },
        edges: {
          e1: {
            from: { node: "in", port: "value" },
            to: { node: "hop", port: "collection" },
          },
          e2: {
            from: { node: "hop", port: "collection" },
            to: { node: "out", port: "value" },
          },
        },
      };

      const traversed = await store.executeImp(traverseGraph);
      expect(traversed.rows.map((r) => r.id).sort()).toEqual(["b", "c"]);
    } finally {
      await store.close();
    }
  });
});

describe.skipIf(live)("tome-postgres graph store (skipped)", () => {
  test("skipped when POSTGRES_URI is unset or unreachable", () => {
    expect(POSTGRES_URI ? "unreachable" : "unset").toBeTruthy();
  });
});
