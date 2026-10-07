import type { LocalSessionResponse, MeResponse } from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service.js';
import { startTestContext, type TestContext } from '../testing/test-app.js';
import { recoverAdmin } from './admin-recovery.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContext({
    auth: {
      idpEnabled: false,
      sessionIdleMs: 8 * 3_600_000,
      sessionMaxMs: 24 * 3_600_000,
      loginMaxAttempts: 5,
      loginLockMs: 15 * 60_000,
    },
  });
});
afterAll(async () => {
  await ctx.close();
});

const login = async (email: string, password: string) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/local/login',
    payload: { email, password },
  });

describe('spec 014 — FR-016/SC-008: comando de recuperação do operador', () => {
  it('SC-008: numa instalação só com usuários do IdP (sem senha), cria um administrador que entra', async () => {
    // Instalação existente: usuário do IdP, sem senha local, e o IdP agora desligado.
    await ctx.database.db
      .insertInto('users')
      .values({ external_id: 'kc-1', email: 'idp@olly.local', name: 'Do IdP' })
      .execute();
    expect((await login('idp@olly.local', 'qualquer-coisa-aqui')).statusCode).toBe(401);

    const created = await recoverAdmin(ctx.database.db, new AuditService(), {
      email: 'Ops@Olly.local',
      name: 'Operação',
    });
    expect(created.created).toBe(true);
    const res = await login('ops@olly.local', created.temporaryPassword);
    expect(res.statusCode).toBe(200);
    const session = res.json<LocalSessionResponse>();
    expect(session.mustChangePassword).toBe(true);
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(me.json<MeResponse>().permissions.global).toContain('user:manage');
  });

  it('FR-016: devolve o acesso a um usuário existente (bloqueado ou inativo) e audita', async () => {
    await ctx.database.db
      .updateTable('users')
      .set({ is_active: false, locked_until: new Date(Date.now() + 3_600_000), is_admin: false })
      .where('email', '=', 'idp@olly.local')
      .execute();
    const result = await recoverAdmin(ctx.database.db, new AuditService(), {
      email: 'idp@olly.local',
    });
    expect(result.created).toBe(false);
    expect((await login('idp@olly.local', result.temporaryPassword)).statusCode).toBe(200);
    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .select(['action', 'details'])
      .where('action', '=', 'auth.admin_recovery')
      .execute();
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain(result.temporaryPassword);
  });
});
