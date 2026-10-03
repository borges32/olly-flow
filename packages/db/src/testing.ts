import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, type Db } from './client.js';
import { migrateToLatest } from './migrator.js';
import { seedRoles } from './seed.js';

export interface TestDatabase {
  db: Db;
  connectionString: string;
  container: StartedPostgreSqlContainer;
  stop(): Promise<void>;
}

/** Sobe um PostgreSQL 16 descartável (Testcontainers). Somente para testes de integração. */
export async function startTestDatabase(
  options: { migrate?: boolean; seed?: boolean } = {},
): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const connectionString = container.getConnectionUri();
  const db = createDb({ connectionString, max: 5 });
  if (options.migrate ?? true) await migrateToLatest(db);
  if (options.seed ?? true) await seedRoles(db);
  return {
    db,
    connectionString,
    container,
    stop: async () => {
      await db.destroy();
      await container.stop();
    },
  };
}
