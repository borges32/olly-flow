import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb } from '@olly/db';
import { AuditService } from '../audit/audit.service.js';
import { recoverAdmin } from '../auth/admin-recovery.js';
import { ConfigError, loadConfig } from '../config/config.js';

/**
 * Spec 014 (FR-016): cria um administrador local ou devolve o acesso a um, no servidor.
 *
 *   pnpm --filter @olly/api users:admin --email <e-mail> [--name <nome>]
 *   docker compose exec api node apps/api/dist/cli/users-admin.js --email <e-mail>
 *
 * A senha temporária aparece uma única vez e precisa ser trocada no primeiro acesso.
 */
const rootEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  fail(error instanceof ConfigError ? error.message : String(error));
}
const email = flag('email');
if (!email?.includes('@')) fail('Uso: users-admin --email <e-mail> [--name <nome>]');
const name = flag('name');

const db = createDb({ connectionString: config.databaseUrl, max: 1 });
try {
  const result = await recoverAdmin(db, new AuditService(), { email, ...(name && { name }) });
  console.log(
    `${result.created ? 'Administrador criado' : 'Acesso de administrador devolvido'}: ${email}`,
  );
  console.log(`Senha temporária (troque no primeiro acesso): ${result.temporaryPassword}`);
} finally {
  await db.destroy();
}
