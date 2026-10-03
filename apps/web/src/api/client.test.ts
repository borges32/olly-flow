import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(response: Response, { anonymous = false } = {}) {
  const token = anonymous ? undefined : 'abc';
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  const onUnauthorized = vi.fn();
  const onForbidden = vi.fn();
  const client = createApiClient({
    getAccessToken: () => token,
    onUnauthorized,
    onForbidden,
    fetch: fetchMock,
  });
  return { client, fetchMock, onUnauthorized, onForbidden };
}

describe('apiClient', () => {
  it('injeta o bearer token e devolve o JSON', async () => {
    const { client, fetchMock } = setup(jsonResponse(200, { ok: true }));
    await expect(client.get('/api/v1/me')).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/me');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer abc');
  });

  it('não envia authorization sem sessão', async () => {
    const { client, fetchMock } = setup(jsonResponse(200, {}), { anonymous: true });
    await client.get('/x');
    expect(
      (fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).authorization,
    ).toBeUndefined();
  });

  it('FR-007: 401 leva ao relogin', async () => {
    const { client, onUnauthorized, onForbidden } = setup(
      jsonResponse(401, {
        error: { code: 'unauthenticated', message: 'Token expirado', requestId: 'r1' },
      }),
    );
    const error = await client.get('/api/v1/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'unauthenticated', requestId: 'r1' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(onForbidden).not.toHaveBeenCalled();
  });

  it('403 avisa acesso negado sem deslogar', async () => {
    const { client, onUnauthorized, onForbidden } = setup(
      jsonResponse(403, { error: { code: 'permission_denied', message: 'Sem permissão' } }),
    );
    await expect(client.get('/x')).rejects.toMatchObject({ status: 403 });
    expect(onForbidden).toHaveBeenCalledWith('Sem permissão');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('erro sem corpo padrão usa o status HTTP', async () => {
    const { client } = setup(new Response('oops', { status: 502, statusText: 'Bad Gateway' }));
    await expect(client.get('/x')).rejects.toMatchObject({
      status: 502,
      code: 'http_error',
      message: 'Bad Gateway',
    });
  });
});
