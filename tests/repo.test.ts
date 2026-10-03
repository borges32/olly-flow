import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listFiles, read, readJson, root } from './helpers.js';

describe('FR-001: monorepo com os workspaces de stack.md', () => {
  const packages = [
    'apps/api',
    'apps/web',
    'packages/shared-types',
    'packages/nodes',
    'packages/db',
  ];
  const reserved = [
    'apps/worker',
    'apps/task-runner',
    'apps/python-runner',
    'packages/engine',
    'packages/expressions',
    'packages/mcp-client',
    'packages/importer-n8n',
  ];

  it('FR-001: workspaces pnpm declarados e Node 22 fixado', () => {
    expect(read('pnpm-workspace.yaml')).toMatch(/- apps\/\*[\s\S]*- packages\/\*/);
    expect(read('.nvmrc').trim()).toBe('22');
    expect((readJson('package.json') as { packageManager: string }).packageManager).toMatch(
      /^pnpm@/,
    );
  });

  it.each(packages)('FR-001: %s é um workspace com build, lint, typecheck e test', (dir) => {
    const pkg = readJson(`${dir}/package.json`) as {
      name: string;
      scripts: Record<string, string>;
    };
    expect(pkg.name).toMatch(/^@olly\//);
    expect(Object.keys(pkg.scripts)).toEqual(
      expect.arrayContaining(['build', 'lint', 'typecheck', 'test']),
    );
  });

  it.each(reserved)('FR-001: %s está reservado com README indicando a spec de origem', (dir) => {
    expect(read(`${dir}/README.md`)).toMatch(/specs\/0\d\d-/);
  });

  it('FR-001: scripts raiz do plano existem', () => {
    const { scripts } = readJson('package.json') as { scripts: Record<string, string> };
    for (const s of [
      'lint',
      'typecheck',
      'test',
      'test:integration',
      'test:e2e',
      'build',
      'dev',
      'smoke',
      'db:migrate',
      'db:rollback',
      'db:seed',
    ]) {
      expect(scripts).toHaveProperty(s);
    }
  });
});

describe('FR-002: ambiente local com healthchecks', () => {
  const compose = read('docker-compose.yml');

  it.each(['postgres', 'redis', 'keycloak', 'minio'])(
    'FR-002: serviço %s com healthcheck',
    (service) => {
      const block = new RegExp(
        `\\n  ${service}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|\\nvolumes:)`,
      ).exec(compose);
      expect(block, `serviço ${service} ausente`).not.toBeNull();
      expect(block?.[1]).toContain('healthcheck:');
    },
  );

  it('FR-002: não há serviço one-shot que quebre `docker compose up --wait`', () => {
    expect(compose).not.toMatch(/restart: ['"]?no/);
  });
});

describe('FR-008: integração com o IdP sem código de fornecedor', () => {
  it('FR-008: o código das apps não referencia o fornecedor do IdP de desenvolvimento', () => {
    const sources = [...listFiles('apps/api/src'), ...listFiles('apps/web/src')];
    expect(sources.length).toBeGreaterThan(10);
    const offenders = sources.filter((f) => /keycloak/i.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe('FR-015: CI', () => {
  const ci = read('.github/workflows/ci.yml');

  it.each([
    'pnpm lint',
    'pnpm typecheck',
    'pnpm test',
    'pnpm build',
    'pnpm test:integration',
    'pnpm test:e2e',
    'pnpm smoke',
  ])('FR-015: executa %s', (command) => {
    expect(ci).toContain(`run: ${command}`);
  });

  it('FR-015: auditoria de dependências falha com vulnerabilidade alta', () => {
    expect(ci).toContain('pnpm audit --audit-level=high');
  });

  it('FR-015: instala com lockfile congelado e roda em push e pull request', () => {
    expect(ci).toContain('pnpm install --frozen-lockfile');
    expect(ci).toMatch(/on:\s*\n\s+push:[\s\S]*pull_request:/);
  });
});

describe('NFR-002: nenhum segredo real versionado', () => {
  it('NFR-002: .env é ignorado e só .env.example é versionado', () => {
    const gitignore = read('.gitignore');
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
    expect(existsSync(join(root, '.env.example'))).toBe(true);
  });

  it('NFR-002: .env.example declara todas as variáveis da configuração do plano', () => {
    const example = read('.env.example');
    for (const v of [
      'DATABASE_URL',
      'REDIS_URL',
      'OIDC_ISSUER_URL',
      'OIDC_CLIENT_ID',
      'OIDC_AUDIENCE',
      'S3_ENDPOINT',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
      'S3_BUCKET',
    ]) {
      expect(example).toMatch(new RegExp(`^${v}=`, 'm'));
    }
  });
});
