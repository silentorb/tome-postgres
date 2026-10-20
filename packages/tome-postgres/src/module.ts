import type { TomeCacheModule } from "tome-service-interfaces";
import { openPostgresCache } from "./cache";
import {
  resolvePostgresConnectionString,
  type PostgresConnectionOptions,
} from "./resolve-connection";

/**
 * Postgres store module for Tome `dataStores` wiring.
 * Thin Imp/test pipe over the single SoT — not a product cache path.
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
