import { fileURLToPath } from 'node:url';
import type { VaultOptions } from '@olly/db';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const INIT_SCRIPT = fileURLToPath(new URL('../../../../infra/vault/init.sh', import.meta.url));
const ROOT_TOKEN = 'root-de-teste';

export interface TestVault {
  container: StartedTestContainer;
  options: VaultOptions;
  address: string;
  /** Chamada administrativa (token root do modo dev), para preparar cenários. */
  admin(method: string, path: string, body?: unknown): Promise<unknown>;
  stop(): Promise<void>;
}

/**
 * Vault em modo dev (spec 009) preparado pelo mesmo `infra/vault/init.sh` do compose: Transit
 * com a chave `olly-credentials` e o AppRole `olly-api`.
 */
export async function startTestVault(): Promise<TestVault> {
  const roleId = 'olly-api-role-de-teste';
  const secretId = 'olly-api-secret-de-teste';
  const container = await new GenericContainer('hashicorp/vault:1.20')
    .withCommand(['server', '-dev', '-dev-listen-address=0.0.0.0:8200'])
    .withEnvironment({ VAULT_DEV_ROOT_TOKEN_ID: ROOT_TOKEN, SKIP_SETCAP: 'true' })
    .withExposedPorts(8200)
    .withCopyFilesToContainer([{ source: INIT_SCRIPT, target: '/init.sh', mode: 0o755 }])
    .withWaitStrategy(Wait.forHttp('/v1/sys/health', 8200).forStatusCode(200))
    .start();
  const init = await container.exec(['sh', '/init.sh'], {
    env: {
      VAULT_TOKEN: ROOT_TOKEN,
      OLLY_VAULT_ROLE_ID: roleId,
      OLLY_VAULT_SECRET_ID: secretId,
    },
  });
  if (init.exitCode !== 0) throw new Error(`init.sh do Vault falhou: ${init.output}`);
  const address = `http://${container.getHost()}:${container.getMappedPort(8200)}`;
  return {
    container,
    address,
    options: {
      address,
      auth: 'approle',
      roleId,
      secretId,
      transitMount: 'transit',
      transitKey: 'olly-credentials',
    },
    async admin(method, path, body) {
      const res = await fetch(`${address}/v1/${path}`, {
        method,
        headers: { 'x-vault-token': ROOT_TOKEN, 'content-type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      if (!res.ok) throw new Error(`Vault ${method} ${path}: ${res.status} ${await res.text()}`);
      return res.status === 204 ? null : res.json();
    },
    stop: async () => {
      await container.stop();
    },
  };
}
