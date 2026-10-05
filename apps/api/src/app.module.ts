import { Module, RequestMethod, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { Options as PinoHttpOptions } from 'pino-http';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BinaryModule } from './binary/binary.module.js';
import { CredentialsModule } from './credentials/credentials.module.js';
import { DomainExceptionFilter } from './common/domain-exception.filter.js';
import type { AppConfig } from './config/config.js';
import { CoreModule } from './core/core.module.js';
import { ExecutionsModule } from './executions/executions.module.js';
import { ExpressionsModule } from './expressions/expressions.module.js';
import { HealthModule } from './health/health.module.js';
import { NodeTypesModule } from './node-types/node-types.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { UsersModule } from './users/users.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';
import { WorkflowsModule } from './workflows/workflows.module.js';

export interface AppOptions {
  /** Destino dos logs (testes de vazamento de segredos, spec 004 SC-002). Padrão: stdout. */
  logStream?: DestinationStream;
}

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, options: AppOptions = {}): DynamicModule {
    const pinoOptions: PinoHttpOptions = {
      level: config.logLevel,
      // O id já foi definido pelo Fastify (ver app.ts) e copiado para o cabeçalho.
      genReqId: (req) => String(req.headers['x-request-id']),
      // Spec 004, FR-003: corpos não são registrados; os caminhos de credencial ficam como
      // garantia caso algum log passe a incluir o corpo da requisição.
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'req.body.data',
        '*.password',
        '*.token',
        '*.clientSecret',
        '*.secret',
      ],
      autoLogging: { ignore: (req) => req.url === '/health' },
    };
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(config),
        LoggerModule.forRoot({
          pinoHttp: options.logStream ? [pinoOptions, options.logStream] : pinoOptions,
          // O padrão do nestjs-pino ('*') usa a sintaxe antiga do path-to-regexp.
          forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
        }),
        AuditModule,
        AuthModule,
        HealthModule,
        UsersModule,
        NodeTypesModule,
        BinaryModule,
        CredentialsModule,
        ProjectsModule,
        WorkflowsModule,
        ExpressionsModule,
        ExecutionsModule,
        WebhooksModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
    };
  }
}
