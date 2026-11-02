import { type Database, createDbHandle } from '@omni/db';
import { type PgSuperAccess, pgRoleUrl, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { dropDatabaseOrThrow } from '@omni/db/pg-testing';

/**
 * One migrated clone and independent pool per suite. Register teardown even if
 * setup fails: the database name exists before provisioning starts, unlike the
 * historical provisionDatabase result, which is returned only after success.
 * Callers choose their opt-in environment; this helper never falls back to G6.
 */
export function createMigratedTestDatabase(access: PgSuperAccess): {
  setup(): Database;
  teardown(): Promise<void>;
} {
  const database = `omni_legacy_${crypto.randomUUID().replaceAll('-', '')}`;
  let close: (() => Promise<void>) | undefined;
  return {
    setup() {
      provisionMigratedDatabase({ ...access, superUrl: pgRoleUrl(access.superUrl, 'postgres') }, database);
      const handle = createDbHandle({ url: pgRoleUrl(access.superUrl, database), maxConnections: 4 });
      close = handle.close;
      return handle.db;
    },
    async teardown() {
      const errors: unknown[] = [];
      try {
        await close?.();
      } catch (error) {
        errors.push(error);
      }
      try {
        dropDatabaseOrThrow(access, database);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) throw new AggregateError(errors, 'Test database teardown failed');
    },
  };
}
