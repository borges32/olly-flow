import { DEFAULT_ROLE_PERMISSIONS, type ApiErrorBody, type MeResponse } from '@olly/shared-types';
import { UnsecuredJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestContext, type TestContext } from '../testing/test-app.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContext();
});
afterAll(async () => {
  await ctx.close();
});

const editor = {
  sub: 'sub-editor',
  email: 'editor@olly.local',
  name: 'Eduardo Editor',
  groups: ['editor'],
};

function getMe(token?: string) {
  return ctx.app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe('FR-004: rotas não públicas exigem token válido', () => {
  it('FR-004: sem token → 401 com corpo de erro padrão', async () => {
    const res = await getMe();
    expect(res.statusCode).toBe(401);
    const { error } = res.json<ApiErrorBody>();
    expect(error.code).toBe('unauthenticated');
    expect(error.requestId).toBeTruthy();
  });

  it('FR-004: esquema diferente de Bearer → 401', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: 'Basic YWRtaW46YWRtaW4=' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('FR-004: token malformado → 401', async () => {
    expect((await getMe('nao-e-um-jwt')).statusCode).toBe(401);
  });

  it('FR-004: assinatura inválida (chave fora do JWKS) → 401', async () => {
    expect((await getMe(await ctx.issuer.signWithForeignKey(editor))).statusCode).toBe(401);
  });

  it('FR-004: token sem assinatura (alg none) → 401', async () => {
    const token = new UnsecuredJWT(editor)
      .setIssuer(ctx.issuer.issuerUrl)
      .setAudience('olly-api')
      .setExpirationTime('5m')
      .encode();
    expect((await getMe(token)).statusCode).toBe(401);
  });

  it('FR-004: emissor diferente → 401', async () => {
    const token = await ctx.issuer.sign(editor, { issuer: 'http://outro-idp.local' });
    expect((await getMe(token)).statusCode).toBe(401);
  });

  it('FR-004: audiência diferente (ex.: ID token do frontend) → 401', async () => {
    const token = await ctx.issuer.sign(editor, { audience: 'olly-web' });
    const res = await getMe(token);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { message: 'Token inválido: claim aud' } });
  });

  it('FR-004: token expirado → 401', async () => {
    const token = await ctx.issuer.sign(editor, { expiresIn: Math.floor(Date.now() / 1000) - 60 });
    const res = await getMe(token);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { message: 'Token expirado' } });
  });

  it('FR-004: token sem exp → 401', async () => {
    const res = await getMe(await ctx.issuer.sign(editor, { expiresIn: null }));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { message: 'Token inválido: claim exp' } });
  });

  it('FR-004: rota pública /health responde sem token', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('FR-004: token válido → 200 e x-request-id na resposta', async () => {
    const res = await getMe(await ctx.issuer.sign(editor));
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('FR-005: sincronização do usuário com o IdP', () => {
  const claims = {
    sub: 'sub-novo',
    email: 'Nova.Pessoa@olly.local',
    name: 'Nova Pessoa',
    groups: [],
  };

  it('FR-005: primeiro login cria o usuário com os dados do IdP', async () => {
    const before = await ctx.database.db
      .selectFrom('users')
      .selectAll()
      .where('external_id', '=', claims.sub)
      .executeTakeFirst();
    expect(before).toBeUndefined();

    expect((await getMe(await ctx.issuer.sign(claims))).statusCode).toBe(200);

    const user = await ctx.database.db
      .selectFrom('users')
      .selectAll()
      .where('external_id', '=', claims.sub)
      .executeTakeFirstOrThrow();
    expect(user).toMatchObject({
      email: 'nova.pessoa@olly.local',
      name: 'Nova Pessoa',
      is_active: true,
    });
  });

  it('FR-005: logins seguintes atualizam nome e e-mail sem duplicar', async () => {
    const first = (await getMe(await ctx.issuer.sign(claims))).json<MeResponse>();
    const updated = { ...claims, email: 'nova.pessoa2@olly.local', name: 'Nova P. Silva' };
    const res = await getMe(await ctx.issuer.sign(updated));
    expect(res.json<MeResponse>()).toMatchObject({
      id: first.id,
      email: 'nova.pessoa2@olly.local',
      name: 'Nova P. Silva',
    });
    const rows = await ctx.database.db
      .selectFrom('users')
      .select(['id', 'updated_at'])
      .where('external_id', '=', claims.sub)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.updated_at).not.toBeNull();
  });

  it('FR-005: token sem e-mail é rejeitado', async () => {
    expect((await getMe(await ctx.issuer.sign({ sub: 'sub-sem-email' }))).statusCode).toBe(401);
  });

  it('FR-005: e-mail já usado por outro usuário → 409', async () => {
    const token = await ctx.issuer.sign({ sub: 'outro-sub', email: 'nova.pessoa2@olly.local' });
    expect((await getMe(token)).statusCode).toBe(409);
  });

  it('FR-005: usuário inativo → 403', async () => {
    const inactive = { sub: 'sub-inativo', email: 'inativo@olly.local', name: 'Inativo' };
    await ctx.database.db
      .insertInto('users')
      .values({
        external_id: inactive.sub,
        email: inactive.email,
        name: inactive.name,
        is_active: false,
      })
      .execute();
    expect((await getMe(await ctx.issuer.sign(inactive))).statusCode).toBe(403);
  });
});

describe('FR-006: GET /api/v1/me', () => {
  it('FR-006: retorna o usuário e as permissões efetivas (formato da spec 002)', async () => {
    const res = await getMe(await ctx.issuer.sign(editor));
    const { id, ...body } = res.json<MeResponse>();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toEqual({
      email: 'editor@olly.local',
      name: 'Eduardo Editor',
      permissions: { global: [], projects: {} },
      // Spec 014: sessão pelo IdP, sem troca de senha pendente.
      authMethod: 'idp',
      mustChangePassword: false,
    });
  });

  it('FR-006: o grupo de administração concede todas as permissões globalmente', async () => {
    const token = await ctx.issuer.sign({
      sub: 'sub-admin',
      email: 'admin@olly.local',
      groups: ['admin'],
    });
    expect((await getMe(token)).json<MeResponse>().permissions.global).toEqual(
      [...DEFAULT_ROLE_PERMISSIONS.admin].sort(),
    );
  });

  it('FR-006: sem nome, devolve name nulo', async () => {
    const token = await ctx.issuer.sign({ sub: 'sub-sem-grupo', email: 'semgrupo@olly.local' });
    expect((await getMe(token)).json<MeResponse>()).toMatchObject({ name: null });
  });
});
