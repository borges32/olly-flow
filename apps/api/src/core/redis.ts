import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Conexão Redis dedicada (spec 006): assinaturas pub/sub e a fila (BullMQ) precisam de uma
 * conexão própria, que espera o Redis voltar em vez de falhar o comando (`maxRetriesPerRequest:
 * null`). As assinaturas são refeitas automaticamente na reconexão.
 */
export function createRedisConnection(url: string, name: string): Redis {
  const logger = new Logger(`Redis:${name}`);
  const redis = new Redis(url, { maxRetriesPerRequest: null, connectionName: `olly-${name}` });
  let healthy = true;
  redis.on('error', (err: Error) => {
    if (healthy) logger.warn(`Redis indisponível: ${err.message}`);
    healthy = false;
  });
  redis.on('ready', () => {
    if (!healthy) logger.log('Redis reconectado');
    healthy = true;
  });
  return redis;
}
