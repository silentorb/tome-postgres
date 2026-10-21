import { Client } from "pg";
import type { TomeSearchBackend } from "tome-interfaces/search";
import { openPostgresFtsSearch } from "./fts-search";
import {
  resolvePostgresConnectionString,
  type PostgresConnectionOptions,
} from "./resolve-connection";
import { ensureSchema } from "./schema";

export type PostgresFtsOpenOptions = PostgresConnectionOptions & {
  clean?: boolean;
};

/**
 * dataStores factory for same-DB Postgres FTS (no sync-fed indexing).
 *
 * ```ts
 * {
 *   module: "tome-postgres",
 *   export: "createPostgresFtsModule",
 *   options: { connectionString: "…" } // or POSTGRES_URI
 * }
 * ```
 */
export function createPostgresFtsModule() {
  return {
    id: "tome-postgres-fts",
    async open(options: PostgresFtsOpenOptions = {}): Promise<TomeSearchBackend> {
      const connectionString = resolvePostgresConnectionString(options);
      const client = new Client({ connectionString });
      await client.connect();
      try {
        await ensureSchema(client);
      } catch (err) {
        await client.end().catch(() => undefined);
        throw err;
      }
      const backend = openPostgresFtsSearch(client, options);
      return {
        search: backend.search,
        close() {
          void client.end();
        },
      };
    },
  };
}
