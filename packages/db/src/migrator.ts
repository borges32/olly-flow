import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Migrator,
  NO_MIGRATIONS,
  sql,
  type Migration,
  type MigrationProvider,
  type MigrationResultSet,
} from 'kysely';
import type { Db } from './client.js';

/** `infra/migrations` na raiz do repositório (vale tanto para `src/` quanto para `dist/`). */
export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../infra/migrations', import.meta.url),
);

const UP = '.up.sql';
const DOWN = '.down.sql';

/**
 * Migrations em SQL puro (`NNNN_nome.up.sql` + `NNNN_nome.down.sql`). Arquivos SQL rodam
 * igual em `tsx`, Vitest e no build, sem depender de importar TypeScript em tempo de execução.
 */
export class SqlFileMigrationProvider implements MigrationProvider {
  constructor(private readonly dir: string = DEFAULT_MIGRATIONS_DIR) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const files = new Set((await readdir(this.dir)).filter((f) => f.endsWith('.sql')));
    const migrations: Record<string, Migration> = {};

    for (const file of files) {
      if (file.endsWith(DOWN) && !files.has(file.slice(0, -DOWN.length) + UP)) {
        throw new Error(`Migration ${file} sem o arquivo ${UP} correspondente`);
      }
      if (!file.endsWith(UP)) continue;
      const name = file.slice(0, -UP.length);
      if (!files.has(name + DOWN)) {
        throw new Error(`Migration ${name} sem ${DOWN}: toda migration precisa ser reversível`);
      }
      const [up, down] = await Promise.all([
        readFile(join(this.dir, name + UP), 'utf8'),
        readFile(join(this.dir, name + DOWN), 'utf8'),
      ]);
      migrations[name] = {
        up: async (db) => {
          await sql.raw(up).execute(db);
        },
        down: async (db) => {
          await sql.raw(down).execute(db);
        },
      };
    }
    return migrations;
  }
}

export function createMigrator(db: Db, dir?: string): Migrator {
  return new Migrator({ db, provider: new SqlFileMigrationProvider(dir) });
}

function unwrap(result: MigrationResultSet): string[] {
  if (result.error) {
    const failed = result.results?.find((r) => r.status === 'Error');
    const cause =
      result.error instanceof Error ? result.error.message : JSON.stringify(result.error);
    throw new Error(`Falha na migration ${failed?.migrationName ?? '?'}: ${cause}`, {
      cause: result.error,
    });
  }
  return (result.results ?? []).map((r) => `${r.direction} ${r.migrationName}`);
}

export async function migrateToLatest(db: Db, dir?: string): Promise<string[]> {
  return unwrap(await createMigrator(db, dir).migrateToLatest());
}

/** Reverte a última migration aplicada ou, com `all`, todas. */
export async function migrateDown(
  db: Db,
  options: { all?: boolean; dir?: string } = {},
): Promise<string[]> {
  const migrator = createMigrator(db, options.dir);
  return unwrap(
    options.all ? await migrator.migrateTo(NO_MIGRATIONS) : await migrator.migrateDown(),
  );
}
