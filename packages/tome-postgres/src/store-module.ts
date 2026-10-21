import type { TomeGraphStoreQueryable } from "tome-graph-interfaces";
import type { TomeQueryCache, TomeQueryCacheOpenOptions } from "tome-service-interfaces";
import { openPostgresCache } from "./cache";
import { openPostgresGraphStore } from "./graph-store";
import {
  resolvePostgresConnectionString,
  type PostgresConnectionOptions,
} from "./resolve-connection";

/**
 * Opened Postgres query SoT: authoritative Queryable graph store plus thin
 * `TomeQueryCache` surface over the same database (separate clients).
 */
export type PostgresSoTHandle = {
  graphStore: TomeGraphStoreQueryable;
  cache: TomeQueryCache;
  close(): Promise<void>;
};

export type PostgresStoreOpenOptions = TomeQueryCacheOpenOptions &
  PostgresConnectionOptions;

/**
 * dataStores factory for Postgres as a Queryable SoT (no CacheSync sink).
 * Host session open recognizes the `{ graphStore, cache }` return shape.
 *
 * ```ts
 * {
 *   module: "tome-postgres",
 *   export: "createPostgresStoreModule",
 *   options: { connectionString: "…" } // or POSTGRES_URI
 * }
 * ```
 */
export function createPostgresStoreModule() {
  return {
    id: "tome-postgres-store",
    async open(options: PostgresStoreOpenOptions = {}): Promise<PostgresSoTHandle> {
      const connectionString = resolvePostgresConnectionString(options);
      const clean = options.clean === true;
      const graphStore = await openPostgresGraphStore({
        connectionString,
        clean,
      });
      let cache: TomeQueryCache;
      try {
        // Schema already ensured by graph store; avoid double-truncate.
        cache = await openPostgresCache({
          connectionString,
          clean: false,
        });
      } catch (err) {
        await graphStore.close().catch(() => undefined);
        throw err;
      }
      return {
        graphStore,
        cache,
        async close() {
          await cache.close();
          await graphStore.close();
        },
      };
    },
  };
}

/** Duck-type check for session open / registry. */
export function isPostgresSoTHandle(value: unknown): value is PostgresSoTHandle {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.graphStore != null &&
    typeof v.graphStore === "object" &&
    v.cache != null &&
    typeof v.cache === "object" &&
    typeof v.close === "function"
  );
}
