import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ROLE_PERMISSIONS,
  type ExecutionDetail,
  type Permission,
  type ProjectSummary,
  type RoleName,
  type TestRunResponse,
  type WorkflowDefinition,
  type WorkflowDetail,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

/**
 * Spec 005, FR-017/SC-004: matriz papel × ação executada contra a API real. A expectativa vem do
 * seed de papéis (`DEFAULT_ROLE_PERMISSIONS`); o resultado gera `docs/rbac-matriz.md`. O teste
 * falha se o documento versionado divergir (regenere com `OLLY_UPDATE_RBAC_MATRIX=1`).
 */
const MATRIX_FILE = fileURLToPath(new URL('../../../../docs/rbac-matriz.md', import.meta.url));

type Subject = RoleName | 'outsider';
const SUBJECTS: Subject[] = ['admin', 'editor', 'executor', 'viewer', 'outsider'];
const LABEL: Record<Subject, string> = {
  admin: 'admin',
  editor: 'editor',
  executor: 'executor',
  viewer: 'viewer',
  outsider: 'não membro',
};

let ctx: TestContext;
let root: TestUser;
let project: ProjectSummary;
const users = {} as Record<Subject, TestUser>;
let executionId: string;

const definition: WorkflowDefinition = {
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 's',
      type: 'data.set',
      name: 'Dado',
      params: { fields: [{ name: 'x', type: 'number', value: '1' }] },
      position: [200, 0],
    },
  ],
  edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 's', toPort: 'main' }],
  settings: {},
};

const newWorkflow = async () =>
  (
    await root.call('POST', `/projects/${project.id}/workflows`, {
      name: `wf ${Math.random()}`,
      definition,
    })
  ).json<WorkflowDetail>();
const ok = (status: number) => status >= 200 && status < 300;

interface Action {
  name: string;
  permission: Permission;
  /** `true` quando o usuário conseguiu fazer a ação. */
  run(user: TestUser): Promise<boolean>;
}

const ACTIONS: Action[] = [
  {
    name: 'Ver workflows do projeto',
    permission: 'workflow:read',
    run: async (u) => ok((await u.call('GET', `/projects/${project.id}/workflows`)).statusCode),
  },
  {
    name: 'Criar workflow',
    permission: 'workflow:create',
    run: async (u) =>
      ok((await u.call('POST', `/projects/${project.id}/workflows`, { name: 'novo' })).statusCode),
  },
  {
    name: 'Editar workflow',
    permission: 'workflow:update',
    run: async (u) => {
      const wf = await newWorkflow();
      return ok(
        (await u.call('PUT', `/workflows/${wf.id}`, { definition, baseVersion: wf.version }))
          .statusCode,
      );
    },
  },
  {
    name: 'Excluir workflow',
    permission: 'workflow:delete',
    run: async (u) =>
      ok((await u.call('DELETE', `/workflows/${(await newWorkflow()).id}`)).statusCode),
  },
  {
    name: 'Executar (teste)',
    permission: 'workflow:execute',
    run: async (u) => {
      const wf = await newWorkflow();
      return ok((await u.call('POST', `/workflows/${wf.id}/test-run`, { definition })).statusCode);
    },
  },
  {
    name: 'Publicar e despublicar',
    permission: 'workflow:publish',
    run: async (u) => {
      const wf = await newWorkflow();
      const published = ok((await u.call('POST', `/workflows/${wf.id}/publish`, {})).statusCode);
      const unpublished = ok((await u.call('POST', `/workflows/${wf.id}/unpublish`)).statusCode);
      return published && unpublished;
    },
  },
  {
    name: 'Ver execuções',
    permission: 'execution:read',
    run: async (u) => ok((await u.call('GET', `/executions/${executionId}`)).statusCode),
  },
  {
    name: 'Ver dados das execuções',
    permission: 'execution:readData',
    run: async (u) => {
      const res = await u.call('GET', `/executions/${executionId}`);
      return ok(res.statusCode) && !res.json<ExecutionDetail>().dataRedacted;
    },
  },
  {
    name: 'Listar e usar credenciais',
    permission: 'credential:use',
    run: async (u) => ok((await u.call('GET', `/projects/${project.id}/credentials`)).statusCode),
  },
  {
    name: 'Gerenciar credenciais',
    permission: 'credential:manage',
    run: async (u) =>
      ok(
        (
          await u.call('POST', `/projects/${project.id}/credentials`, {
            name: `c ${Math.random()}`,
            type: 'httpBearer',
            data: { token: 'x' },
          })
        ).statusCode,
      ),
  },
  {
    name: 'Gerenciar membros do projeto',
    permission: 'project:manage',
    run: async (u) => ok((await u.call('GET', `/projects/${project.id}/members`)).statusCode),
  },
];

const expected = (subject: Subject, permission: Permission) =>
  subject !== 'outsider' && DEFAULT_ROLE_PERMISSIONS[subject].includes(permission);

function render(results: Record<string, Record<Subject, boolean>>): string {
  const mark = (v: boolean) => (v ? '✅' : '—');
  const rows = ACTIONS.map(
    (a) =>
      `| ${a.name} | \`${a.permission}\` | ${SUBJECTS.map((s) => mark(results[a.name]?.[s] ?? false)).join(' | ')} |`,
  );
  return `# Matriz RBAC

> **Gerado** por \`apps/api/src/rbac/rbac-matrix.int.test.ts\` (spec 005, FR-017), executando cada ação contra a API real com os papéis padrão do seed (\`packages/shared-types/src/rbac.ts\`). Não edite à mão: regenere com \`OLLY_UPDATE_RBAC_MATRIX=1 pnpm --filter @olly/api test:integration\`.

Papéis por projeto. O grupo de administração do IdP (\`OIDC_ADMIN_GROUP\`) tem todas as permissões em todos os projetos. "Não membro" recebe 404 nos recursos do projeto.

| Ação | Permissão | ${SUBJECTS.map((s) => LABEL[s]).join(' | ')} |
|---|---|${SUBJECTS.map(() => ':---:').join('|')}|
${rows.join('\n')}

Permissões sem rota até agora: \`user:manage\` (administração de usuários pelo IdP) e \`audit:read\` (consulta de auditoria, spec 009).
`;
}

beforeAll(async () => {
  ctx = await startTestContext();
  root = await loginAs(ctx, { sub: 'root', email: 'root@t.local', groups: ['admin'] });
  project = (await root.call('POST', '/projects', { name: 'Matriz' })).json<ProjectSummary>();
  for (const subject of SUBJECTS) {
    users[subject] = await loginAs(ctx, { sub: subject, email: `${subject}@t.local` });
    if (subject !== 'outsider') {
      await root.call('PUT', `/projects/${project.id}/members/${users[subject].id}`, {
        role: subject,
      });
    }
  }
  const wf = await newWorkflow();
  executionId = (
    await root.call('POST', `/workflows/${wf.id}/test-run`, { definition })
  ).json<TestRunResponse>().executionId;
  for (let i = 0; i < 100; i++) {
    const d = (await root.call('GET', `/executions/${executionId}`)).json<ExecutionDetail>();
    if (!['queued', 'running'].includes(d.status)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
});
afterAll(async () => {
  await ctx.close();
});

describe('spec 005 — FR-017/SC-004: matriz papel × ação', () => {
  it('FR-017/SC-004: cada papel faz exatamente o que o seed concede e a matriz é documentada', async () => {
    const results: Record<string, Record<Subject, boolean>> = {};
    const divergences: string[] = [];
    for (const action of ACTIONS) {
      results[action.name] = {} as Record<Subject, boolean>;
      for (const subject of SUBJECTS) {
        const allowed = await action.run(users[subject]);
        (results[action.name] as Record<Subject, boolean>)[subject] = allowed;
        if (allowed !== expected(subject, action.permission)) {
          divergences.push(`${LABEL[subject]} × ${action.name}: obtido ${String(allowed)}`);
        }
      }
    }
    expect(divergences).toEqual([]);
    const markdown = render(results);
    if (!existsSync(MATRIX_FILE) || process.env.OLLY_UPDATE_RBAC_MATRIX === '1') {
      writeFileSync(MATRIX_FILE, markdown);
    }
    expect(readFileSync(MATRIX_FILE, 'utf8')).toBe(markdown);
  });
});
