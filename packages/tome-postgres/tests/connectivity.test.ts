import { describe, expect, test } from "bun:test";
import type { Graph } from "imp-core-types";
import {
  compileImpGraphToTomePostgresSql,
  relationshipType,
} from "tome-imp-postgres";
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

describe.skipIf(!live)("tome-postgres connectivity", () => {
  test("open upserts nodes and runs binder filter/limit SQL", async () => {
    const mod = createPostgresModule();
    const cache = await mod.open({ clean: true });
    try {
      await cache.upsertNode("n1", { status: "active", title: "One" });
      await cache.upsertNode("n2", { status: "inactive", title: "Two" });
      await cache.upsertNode("n3", { status: "active", title: "Three" });

      const graph: Graph = {
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

      const { sql, parameters } = compileImpGraphToTomePostgresSql(graph);
      expect(sql).toMatch(/\$\d/);
      const rows = await cache.queryAll<{ id: string }>(sql, ...parameters);
      const ids = rows.map((row) => row.id).sort();
      expect(ids).toEqual(["n1", "n3"]);
    } finally {
      await cache.close();
    }
  });

  test("open upserts relationships and runs binder traverse SQL", async () => {
    const association = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const hopType = relationshipType(association, 0);

    const mod = createPostgresModule();
    const cache = await mod.open({ clean: true });
    try {
      await cache.upsertNode("a", { title: "A" });
      await cache.upsertNode("b", { title: "B" });
      await cache.upsertNode("c", { title: "C" });
      await cache.upsertRelationship("a", "b", hopType, { via: "ab" });
      await cache.upsertRelationship("a", "c", hopType, { via: "ac" });

      const graph: Graph = {
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

      // Traverse: FROM nodes AS sources JOIN relationships … → targets b, c.
      const { sql, parameters } = compileImpGraphToTomePostgresSql(graph);
      expect(parameters).toContain(hopType);
      const rows = await cache.queryAll<{ id: string }>(sql, ...parameters);
      const ids = rows.map((row) => row.id).sort();
      expect(ids).toEqual(["b", "c"]);
    } finally {
      await cache.close();
    }
  });
});

describe.skipIf(live)("tome-postgres connectivity (skipped)", () => {
  test("skipped when POSTGRES_URI is unset or unreachable", () => {
    expect(POSTGRES_URI ? "unreachable" : "unset").toBeTruthy();
  });
});
