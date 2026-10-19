import type { TomeCacheModule } from "tome-service-interfaces";

/**
 * Postgres store module for Tome `dataStores` wiring.
 * Stub: `open()` rejects until graph store / Imp SQL execution are implemented.
 */
export function createPostgresModule(): TomeCacheModule {
  return {
    id: "tome-postgres",
    async open(_options) {
      throw new Error(
        "tome-postgres is a scaffold stub; Postgres graph store is not implemented yet",
      );
    },
  };
}
