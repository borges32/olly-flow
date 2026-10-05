import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { safeEqual, verifyWebhookAuth } from './auth.js';
import { webhookTrigger } from './definition.js';

const body = Buffer.from('{"pedido":42}');

describe('spec 005 — FR-004/NFR-003: autenticação do webhook', () => {
  it('FR-004/SC-002: HMAC válido passa; inválido, ausente ou de outro corpo falha', () => {
    const data = {
      secret: 'segredo-hmac',
      headerName: 'X-Signature',
      algorithm: 'sha256',
      encoding: 'hex',
    };
    const sig = createHmac('sha256', 'segredo-hmac').update(body).digest('hex');
    expect(
      verifyWebhookAuth('webhookHmac', data, { headers: { 'x-signature': sig }, rawBody: body }),
    ).toBe(true);
    expect(
      verifyWebhookAuth('webhookHmac', data, {
        headers: { 'x-signature': `sha256=${sig}` },
        rawBody: body,
      }),
    ).toBe(true);
    expect(
      verifyWebhookAuth('webhookHmac', data, { headers: { 'x-signature': 'abc' }, rawBody: body }),
    ).toBe(false);
    expect(verifyWebhookAuth('webhookHmac', data, { headers: {}, rawBody: body })).toBe(false);
    expect(
      verifyWebhookAuth('webhookHmac', data, {
        headers: { 'x-signature': sig },
        rawBody: Buffer.from('{"pedido":43}'),
      }),
    ).toBe(false);
    const b64 = { ...data, encoding: 'base64', algorithm: 'sha512', headerName: 'X-Hub' };
    const sig64 = createHmac('sha512', 'segredo-hmac').update(body).digest('base64');
    expect(
      verifyWebhookAuth('webhookHmac', b64, { headers: { 'x-hub': sig64 }, rawBody: body }),
    ).toBe(true);
  });

  it('FR-004: header e Basic', () => {
    const header = { name: 'X-Token', value: 't0k3n' };
    expect(
      verifyWebhookAuth('webhookHeaderAuth', header, {
        headers: { 'x-token': 't0k3n' },
        rawBody: body,
      }),
    ).toBe(true);
    expect(
      verifyWebhookAuth('webhookHeaderAuth', header, {
        headers: { 'x-token': 't0k3' },
        rawBody: body,
      }),
    ).toBe(false);
    const basic = { user: 'ana', password: 'pw' };
    const ok = `Basic ${Buffer.from('ana:pw').toString('base64')}`;
    expect(
      verifyWebhookAuth('webhookBasicAuth', basic, {
        headers: { authorization: ok },
        rawBody: body,
      }),
    ).toBe(true);
    expect(
      verifyWebhookAuth('webhookBasicAuth', basic, {
        headers: { authorization: 'Basic x' },
        rawBody: body,
      }),
    ).toBe(false);
    expect(verifyWebhookAuth('desconhecido', {}, { headers: {}, rawBody: body })).toBe(false);
  });

  it('NFR-003: comparação em tempo constante aceita tamanhos diferentes sem lançar', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });

  it('FR-004: o gatilho repassa o item montado pela API', async () => {
    const item = { json: { headers: {}, params: { id: '7' }, query: {}, body: { a: 1 } } };
    expect(
      await webhookTrigger.execute({ inputs: { main: [item] }, items: [item] }, {} as never),
    ).toEqual({
      main: [item],
    });
  });
});
