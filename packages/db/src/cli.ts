import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb } from './client.js';
import { migrateDown, migrateToLatest } from './migrator.js';
import { seedRoles } from './seed.js';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const [command, ...args] = process.argv.slice(2);
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL não definida (veja .env.example)');
  process.exit(1);
}

const db = createDb({ connectionString, max: 1 });
try {
  switch (command) {
    case 'migrate':
      report(await migrateToLatest(db));
      break;
    case 'rollback':
      report(await migrateDown(db, { all: args.includes('--all') }));
      break;
    case 'seed':
      await seedRoles(db);
      console.log('Papéis padrão criados/atualizados.');
      break;
    default:
      console.error('Uso: cli.js <migrate|rollback [--all]|seed>');
      process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.destroy();
}

function report(lines: string[]): void {
  console.log(lines.length > 0 ? lines.join('\n') : 'Nada a fazer.');
}
