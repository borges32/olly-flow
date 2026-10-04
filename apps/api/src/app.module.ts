import { Module, RequestMethod, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DomainExceptionFilter } from './common/domain-exception.filter.js';
import type { AppConfig } from './config/config.js';
import { CoreModule } from './core/core.module.js';
import { ExecutionsModule } from './executions/executions.module.js';
import { ExpressionsModule } from './expressions/expressions.module.js';
import { HealthModule } from './health/health.module.js';
import { NodeTypesModule } from './node-types/node-types.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { UsersModule } from './users/users.module.js';
import { WorkflowsModule } from './workflows/workflows.module.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(config),
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.logLevel,
            // O id já foi definido pelo Fastify (ver app.ts) e copiado para o cabeçalho.
            genReqId: (req) => String(req.headers['x-request-id']),
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
            autoLogging: { ignore: (req) => req.url === '/health' },
          },
          // O padrão do nestjs-pino ('*') usa a sintaxe antiga do path-to-regexp.
          forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
        }),
        AuditModule,
        AuthModule,
        HealthModule,
        UsersModule,
        NodeTypesModule,
        ProjectsModule,
        WorkflowsModule,
        ExpressionsModule,
        ExecutionsModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
    };
  }
}
