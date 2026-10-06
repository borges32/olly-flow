import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { maskingLogOptions } from './log-masking.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { lines, logger: pino({ level: 'info', ...maskingLogOptions }, stream) };
}

describe('spec 009 — FR-014: mascaramento dos logs', () => {
  it('FR-014 (bug): o log "request completed" com o ServerResponse cru não trava a API', async () => {
    // O pino-http registra `{ res, responseTime }` com o objeto do Node antes dos serializers;
    // percorrê-lo (socket, req, server, ciclos) deixava o processo em 100% de CPU.
    const { lines, logger } = capture();
    let elapsed = Number.POSITIVE_INFINITY;
    const server = createServer((req, res) => {
      res.end('ok');
      const t0 = performance.now();
      logger.info({ req, res, responseTime: 3 }, 'request completed');
      elapsed = performance.now() - t0;
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const { port } = server.address() as AddressInfo;
      expect((await fetch(`http://127.0.0.1:${port}/x`)).status).toBe(200);
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
    expect(elapsed).toBeLessThan(1000);
    expect(lines).toHaveLength(1);
  });

  it('FR-014: campos e textos sensíveis continuam mascarados nos logs', () => {
    const { lines, logger } = capture();
    logger.info({ dados: { password: 'segredo', doc: '529.982.247-25' } }, 'CPF 529.982.247-25');
    const line = JSON.parse(lines[0] ?? '{}') as { dados: unknown; msg: string };
    expect(line.dados).toEqual({ password: '***', doc: '***.***.247-**' });
    expect(line.msg).toBe('CPF ***.***.247-**');
  });
});
