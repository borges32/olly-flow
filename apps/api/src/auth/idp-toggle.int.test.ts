import type {
  AuthConfig,
  LocalSessionResponse,
  MeResponse,
  ProjectSummary,
  UserAdminSummary,
} from '@olly/shared-types';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service.js';
import { startTestContext, type TestContext } from '../testing/test-app.js';
import { recordIdpConfig } from './idp-config-audit.js';

let ctx: TestContext;

async function call(
  method: InjectOptions['method'],
  path: string,
  token?: string,
  payload?: unknown,
) {
  return ctx.app.inject({
    method,
    url: `/api/v1${path}`,
    ...(token && { headers: { authorization: `Bearer ${token}` } }),
    ...(payload !== undefined && { payload: payload as InjectOptions['payload'] }),
  });
}

const actions = async (action: string) =>
  ctx.database.db.selectFrom('audit_log').selectAll().where('action', '=', action).execute();

// IdP ligado (a configuração padrão dos testes).
beforeAll(async () => {
  ctx = await startTestContext({});
});
afterAll(async () => {
  await ctx.close();
});

describe('spec 014 — HU-4: login pelo IdP opcional, junto com o login local', () => {
  let local: LocalSessionResponse;

  it('FR-010/FR-011/SC-006: com o IdP ligado, a tela oferece os dois; IdP e local entram', async () => {
    expect((await call('GET', '/auth/config')).json<AuthConfig>()).toEqual({
      setupRequired: true,
      idpEnabled: true,
    });
    const setup = await call('POST', '/auth/setup', undefined, {
      name: 'Ana Local',
      email: 'ana@olly.local',
      password: 'chave-da-ana-segura',
    });
    expect(setup.statusCode).toBe(201);
    local = setup.json<LocalSessionResponse>();
    expect((await call('GET', '/me', local.token)).json<MeResponse>().authMethod).toBe('local');
    const idp = await ctx.issuer.sign({ sub: 'kc-bia', email: 'bia@olly.local', name: 'Bia' });
    const me = (await call('GET', '/me', idp)).json<MeResponse>();
    expect(me).toMatchObject({ email: 'bia@olly.local', authMethod: 'idp' });
  });

  it('FR-015/SC-007: conta do IdP com o mesmo e-mail (verificado) vincula ao usuário local', async () => {
    const project = (
      await call('POST', '/projects', local.token, { name: 'Da Ana' })
    ).json<ProjectSummary>();
    const idp = await ctx.issuer.sign({
      sub: 'kc-ana',
      email: 'ANA@olly.local',
      email_verified: true,
      name: 'Ana pelo IdP',
    });
    const me = (await call('GET', '/me', idp)).json<MeResponse>();
    const viaLocal = (await call('GET', '/me', local.token)).json<MeResponse>();
    expect(me.id).toBe(viaLocal.id);
    expect(me.authMethod).toBe('idp');
    // Mesma pessoa: os mesmos projetos e a administração do usuário local.
    expect(me.permissions.global).toContain('user:manage');
    expect((await call('GET', `/projects/${project.id}/workflows`, idp)).statusCode).toBe(200);
    const users = (await call('GET', '/admin/users', local.token)).json<UserAdminSummary[]>();
    expect(users.find((u) => u.id === me.id)?.origin).toBe('linked');
    expect(await actions('auth.idp_linked')).toHaveLength(1);
    // O login local continua.
    const again = await call('POST', '/auth/local/login', undefined, {
      email: 'ana@olly.local',
      password: 'chave-da-ana-segura',
    });
    expect(again.statusCode).toBe(200);
  });

  it('FR-015/SC-007: sem e-mail verificado pelo IdP, a vinculação é recusada e auditada', async () => {
    await call('POST', '/admin/users', local.token, {
      name: 'Caio',
      email: 'caio@olly.local',
      password: 'chave-inicial-segura',
    });
    for (const claims of [
      { sub: 'kc-caio', email: 'caio@olly.local' },
      { sub: 'kc-caio', email: 'caio@olly.local', email_verified: false },
    ]) {
      const res = await call('GET', '/me', await ctx.issuer.sign(claims));
      expect(res.statusCode).toBe(403);
      expect(res.body).toContain('e-mail');
    }
    expect((await actions('auth.idp_link_refused')).length).toBeGreaterThanOrEqual(1);
  });
});

describe('spec 014 — FR-013: ativação do IdP auditada', () => {
  it('FR-013: a subida registra o estado do IdP só quando ele muda', async () => {
    // A subida deste contexto já registrou o IdP ligado.
    const boot = await actions('auth.idp_config');
    expect(boot.map((r) => r.details)).toEqual([{ enabled: true }]);
    const audit = new AuditService();
    await recordIdpConfig(ctx.database.db, audit, true);
    expect(await actions('auth.idp_config')).toHaveLength(1);
    await recordIdpConfig(ctx.database.db, audit, false);
    await recordIdpConfig(ctx.database.db, audit, false);
    expect((await actions('auth.idp_config')).map((r) => r.details)).toEqual([
      { enabled: true },
      { enabled: false },
    ]);
  });
});
