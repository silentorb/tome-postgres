import { collectionTransformsLibrary } from "imp-collection-transforms"
import { pathingLibrary } from "imp-pathing"
import { createRegistry, loadLibrary } from "imp-registry"
import { coreNodeLibrary } from "imp-core-types"

/**
 * Registry with core + collection transforms + pathing for Tome Postgres Imp hosts.
 * v1 omits corpus / hosts_projection (SQLite-cache-oriented Tome operators).
 */
export function createTomePostgresImpRegistry() {
  return loadLibrary(
    loadLibrary(
      loadLibrary(createRegistry(), coreNodeLibrary),
      collectionTransformsLibrary,
    ),
    pathingLibrary,
  )
}
