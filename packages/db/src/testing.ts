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

/**
 * Imagem do PostgreSQL dos testes de integração: a versão mínima suportada (14.18, a de produção;
 * docs/arquitetura/stack.md), para nenhuma migration ou consulta depender de versão posterior.
 * `OLLY_TEST_POSTGRES_IMAGE` troca a versão (ex.: `postgres:16-alpine`).
 */
export const TEST_POSTGRES_IMAGE = process.env.OLLY_TEST_POSTGRES_IMAGE ?? 'postgres:14.18-alpine';

/** Sobe um PostgreSQL descartável (Testcontainers). Somente para testes de integração. */
export async function startTestDatabase(
  options: { migrate?: boolean; seed?: boolean } = {},
): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(TEST_POSTGRES_IMAGE).start();
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
