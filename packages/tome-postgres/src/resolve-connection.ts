import type { TomeQueryCacheOpenOptions } from "tome-service-interfaces";

/** Module-specific open fields (opaque options bag from `dataStores`). */
export type PostgresConnectionOptions = TomeQueryCacheOpenOptions & {
  connectionString?: string;
  uri?: string;
};

/**
 * Resolve a Postgres connection URI from open options or `POSTGRES_URI`.
 */
export function resolvePostgresConnectionString(
  options?: PostgresConnectionOptions,
): string {
  const fromOptions =
    options?.connectionString?.trim() ||
    options?.uri?.trim() ||
    undefined;
  const fromEnv = process.env.POSTGRES_URI?.trim() || undefined;
  const uri = fromOptions || fromEnv;
  if (!uri) {
    throw new Error(
      "tome-postgres open() requires options.connectionString / options.uri or POSTGRES_URI",
    );
  }
  return uri;
}

/** Display path for the cache handle (password redacted when present). */
export function redactedPostgresPath(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) {
      url.password = "***";
    }
    return url.toString();
  } catch {
    return "postgres";
  }
}
