import { describe, expect, test } from "bun:test";
import {
  createPostgresFtsModule,
  createPostgresStoreModule,
  isPostgresSoTHandle,
  resolvePostgresConnectionString,
} from "../src/index";

const POSTGRES_URI = process.env.POSTGRES_URI?.trim();

async function canConnect(): Promise<boolean> {
  if (!POSTGRES_URI) return false;
  try {
    const mod = createPostgresStoreModule();
    const opened = await mod.open({ clean: true });
    await opened.close();
    return true;
  } catch {
    return false;
  }
}

const live = await canConnect();

describe.skipIf(!live)("tome-postgres host modules (Q4)", () => {
  test("store module returns SoT handle; FTS has no syncEndpoint", async () => {
    const connectionString = resolvePostgresConnectionString();
    const sot = await createPostgresStoreModule().open({
      connectionString,
      clean: true,
    });
    expect(isPostgresSoTHandle(sot)).toBe(true);

    const fts = await createPostgresFtsModule().open({ connectionString });
    try {
      expect(fts.syncEndpoint).toBeUndefined();
      await sot.graphStore.upsertNode(
        { id: "host1", properties: { title: "Host Wiring" } },
        "postgres sot search",
      );
      const hits = await fts.search.search({ query: "wiring", limit: 20 });
      expect(hits.some((h) => h.id === "host1")).toBe(true);
      expect(sot.cache.path.length).toBeGreaterThan(0);
    } finally {
      fts.close();
      await sot.close();
    }
  });
});
