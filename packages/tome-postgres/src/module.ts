import type { TomeCacheModule } from "tome-service-interfaces";
import { openPostgresCache } from "./cache";
import {
  resolvePostgresConnectionString,
  type PostgresConnectionOptions,
} from "./resolve-connection";

/**
 * Postgres store module for Tome `dataStores` wiring.
 * Thin connectivity handle — not full SQLite `TomeQueryCache` parity.
 */
export function createPostgresModule(): TomeCacheModule {
  return {
    id: "tome-postgres",
    async open(options) {
      const connectionString = resolvePostgresConnectionString(
        options as PostgresConnectionOptions | undefined,
      );
      return openPostgresCache({
        connectionString,
        clean: options?.clean,
      });
    },
  };
}
