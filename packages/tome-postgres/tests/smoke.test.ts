import { describe, expect, test } from "bun:test";
import { createPostgresModule } from "../src/index";

describe("createPostgresModule", () => {
  test("returns a module with id tome-postgres", () => {
    const mod = createPostgresModule();
    expect(mod.id).toBe("tome-postgres");
  });

  test("open rejects when connection string is missing", async () => {
    const previous = process.env.POSTGRES_URI;
    delete process.env.POSTGRES_URI;
    try {
      const mod = createPostgresModule();
      await expect(mod.open()).rejects.toThrow(/POSTGRES_URI|connectionString/);
    } finally {
      if (previous !== undefined) {
        process.env.POSTGRES_URI = previous;
      }
    }
  });
});
