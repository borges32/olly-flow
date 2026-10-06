import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb, createKeyRing, VaultTransitKeyProvider } from '@olly/db';
import { AuditService } from '../audit/audit.service.js';
import { ConfigError, loadConfig } from '../config/config.js';
import { rotateCredentialKeys } from '../credentials/key-rotation.js';

/**
 * Spec 009 (FR-002, FR-003): rotação e migração da chave mestra das credenciais, sem parar a API.
 *
 *   pnpm credentials:rotate [--rotate-vault-key]
 *   pnpm credentials:migrate --from env --to vault
 *
 * Usa a mesma configuração da API (OLLY_KEY_PROVIDER, OLLY_MASTER_KEY*, OLLY_VAULT_*).
 */
const rootEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const [command, ...args] = process.argv.slice(2);
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
if (command !== 'rotate' && command !== 'migrate') {
  fail(
    'Uso: credentials <rotate [--rotate-vault-key] | migrate --from <env|vault> --to <env|vault>>',
  );
}

const keys = createKeyRing({
  provider: config.credentials.keyProvider,
  ...(config.credentials.masterKey && { masterKey: config.credentials.masterKey }),
  ...(config.credentials.masterKeyVersion && {
    masterKeyVersion: config.credentials.masterKeyVersion,
  }),
  ...(config.credentials.previousMasterKeys && {
    previousMasterKeys: config.credentials.previousMasterKeys,
  }),
  ...(config.credentials.vault && { vault: config.credentials.vault }),
});

let from: string | undefined;
if (command === 'migrate') {
  from = flag('from');
  const to = flag('to');
  if (!from || !to) fail('Informe --from e --to');
  if (to !== keys.current.id) {
    fail(`--to ${to} difere do provedor configurado (OLLY_KEY_PROVIDER=${keys.current.id})`);
  }
  if (from === to) fail('--from e --to são iguais; para trocar a versão da chave use rotate');
  if (!keys.has(from)) fail(`O provedor de origem ${from} não está configurado`);
}

if (args.includes('--rotate-vault-key')) {
  if (!(keys.current instanceof VaultTransitKeyProvider)) {
    fail('--rotate-vault-key exige OLLY_KEY_PROVIDER=vault');
  }
  const version = await keys.current.rotateKey();
  console.log(`Nova versão da chave no Vault: ${version}`);
}

const db = createDb({ connectionString: config.databaseUrl, max: 2 });
try {
  const report = await rotateCredentialKeys(db, keys, new AuditService(), {
    ...(from && { from }),
    onProgress: (p) => {
      console.log(`… ${p.rewrapped} recifradas, ${p.failed} com falha`);
    },
  });
  console.log(
    `Concluído: ${report.rewrapped} credenciais na chave ${report.target.provider} v${report.target.version}; ${report.failed} com falha.`,
  );
  for (const e of report.errors) console.error(`  ${e.credentialId}: ${e.message}`);
  if (report.failed > 0) process.exitCode = 2;
} finally {
  await db.destroy();
}
