import { describe, expect, test } from "bun:test";
import { createPostgresModule } from "../src/index";

describe("createPostgresModule", () => {
  test("returns a module with id tome-postgres", () => {
    const mod = createPostgresModule();
    expect(mod.id).toBe("tome-postgres");
  });

  test("open rejects until the store is implemented", async () => {
    const mod = createPostgresModule();
    await expect(mod.open()).rejects.toThrow(/not implemented/);
  });
});
