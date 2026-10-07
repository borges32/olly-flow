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
import { GovernanceModule } from './governance/governance.module.js';
import { HealthModule } from './health/health.module.js';
import { maskingLogOptions } from './masking/log-masking.js';
import { pinoHttpWithTelemetry } from './telemetry/log-options.js';
import { MaskingModule } from './masking/masking.module.js';
import { McpModule } from './mcp/mcp.module.js';
import { AiModule } from './ai/ai.module.js';
import { NodeTypesModule } from './node-types/node-types.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { UsersModule } from './users/users.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';
import { WorkflowIoModule } from './workflow-io/workflow-io.module.js';
import { WorkflowsModule } from './workflows/workflows.module.js';

/**
 * Spec 004, FR-003: corpos não são registrados; os caminhos de credencial ficam como garantia
 * caso algum log passe a incluir o corpo da requisição. Também usado pelo worker (spec 006).
 */
export const LOG_REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body.data',
  '*.password',
  '*.token',
  '*.clientSecret',
  '*.secret',
];

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
      redact: LOG_REDACT,
      // Spec 009, FR-014: dados sensíveis mascarados também nos logs.
      ...maskingLogOptions,
      autoLogging: { ignore: (req) => req.url === '/health' },
    };
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(config),
        LoggerModule.forRoot({
          // Spec 012: ids do trace nos logs e envio ao coletor OTel (se configurado).
          pinoHttp: pinoHttpWithTelemetry(pinoOptions, options.logStream),
          // O padrão do nestjs-pino ('*') usa a sintaxe antiga do path-to-regexp.
          forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
        }),
        AuditModule,
        MaskingModule,
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
        GovernanceModule,
        // Spec 010: catálogo MCP, políticas, chamadas e OAuth.
        McpModule,
        // Spec 011: aprovações, uso e custo de IA.
        AiModule,
        // Spec 015: baixar e importar workflows em JSON.
        WorkflowIoModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
    };
  }
}
