import {
  Global,
  Inject,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createDb, type Db } from '@olly/db';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB, REDIS } from './tokens.js';

async function createRedis(url: string): Promise<Redis> {
  const logger = new Logger('Redis');
  // Sem fila offline: com o Redis fora do ar, comandos falham na hora em vez de acumular.
  const redis = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  let healthy = true;
  redis.on('error', (err: Error) => {
    if (healthy) logger.warn(`Redis indisponível: ${err.message}`);
    healthy = false;
  });
  redis.on('ready', () => {
    if (!healthy) logger.log('Redis reconectado');
    healthy = true;
  });
  // Aguarda só a primeira tentativa: com o Redis fora do ar a API sobe mesmo assim
  // (o evento `error` registra e o ioredis segue tentando reconectar).
  await redis.connect().catch(() => undefined);
  return redis;
}

/** Configuração, banco e Redis, compartilhados por todos os módulos. */
@Global()
@Module({})
export class CoreModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        {
          provide: DB,
          useFactory: () => {
            const logger = new Logger('Database');
            return createDb({
              connectionString: config.databaseUrl,
              onPoolError: (err) => {
                logger.warn(`Conexão com o PostgreSQL perdida: ${err.message}`);
              },
            });
          },
        },
        { provide: REDIS, useFactory: () => createRedis(config.redisUrl) },
      ],
      exports: [APP_CONFIG, DB, REDIS],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    this.redis.disconnect();
    await this.db.destroy();
  }
}
