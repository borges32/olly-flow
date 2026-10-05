import { Module, type DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { LOG_REDACT, type AppOptions } from '../app.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { BinaryModule } from '../binary/binary.module.js';
import type { AppConfig } from '../config/config.js';
import { CoreModule } from '../core/core.module.js';
import { CredentialsModule } from '../credentials/credentials.module.js';
import { ExecutionEventSink } from '../executions/execution-events.service.js';
import { ExecutionRunner } from '../executions/execution-runner.js';
import { ExpressionsModule } from '../expressions/expressions.module.js';
import { NodeTypesModule } from '../node-types/node-types.module.js';
import { ExecutionProcessor } from './execution-processor.js';
import { RedisEventPublisher } from './redis-event-publisher.js';

/**
 * Worker (spec 006, plan §2): sem HTTP da API. Reaproveita os módulos de execução (banco, nós,
 * credenciais, binários e o task runner próprio) e publica os eventos no Redis.
 */
@Module({})
export class WorkerModule {
  static forRoot(config: AppConfig, options: AppOptions = {}): DynamicModule {
    const pino = { level: config.logLevel, redact: LOG_REDACT };
    return {
      module: WorkerModule,
      imports: [
        CoreModule.forRoot(config),
        LoggerModule.forRoot({ pinoHttp: options.logStream ? [pino, options.logStream] : pino }),
        AuditModule,
        NodeTypesModule,
        BinaryModule,
        CredentialsModule,
        ExpressionsModule,
      ],
      providers: [
        RedisEventPublisher,
        { provide: ExecutionEventSink, useExisting: RedisEventPublisher },
        ExecutionRunner,
        ExecutionProcessor,
      ],
    };
  }
}
