import {
  Controller,
  Get,
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CredentialTypeRegistry,
  PoolManager,
  builtinCredentialTypes,
  fakeLlmCredential,
  createBuiltinNodes,
  createHttpGuard,
  createNodeRegistry,
  type CredentialTypeDescription,
  type HttpGuard,
  type NodeDescription,
  type NodeRegistry,
} from '@olly/nodes';
import { Authenticated } from '../auth/public.decorator.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

export const NODE_REGISTRY = Symbol('NODE_REGISTRY');
export const CREDENTIAL_TYPES = Symbol('CREDENTIAL_TYPES');
export const HTTP_GUARD = Symbol('HTTP_GUARD');
export const POOL_MANAGER = Symbol('POOL_MANAGER');

@ApiTags('nós')
@ApiBearerAuth()
@Controller()
export class NodeTypesController {
  constructor(
    @Inject(NODE_REGISTRY) private readonly registry: NodeRegistry,
    @Inject(CREDENTIAL_TYPES) private readonly credentialTypes: CredentialTypeRegistry,
  ) {}

  /** Catálogo de tipos de nó para o editor (spec 002, FR-006). */
  @Authenticated()
  @Get('node-types')
  list(): NodeDescription[] {
    return this.registry.list();
  }

  /** Tipos de credencial e seus campos (spec 004, FR-004). */
  @Authenticated()
  @Get('credential-types')
  credentialTypesList(): CredentialTypeDescription[] {
    return this.credentialTypes.list();
  }
}

/**
 * Registro de nós e as dependências dos nós de integração (spec 004, plan §10): filtro
 * anti-SSRF com a allowlist configurada e pools Postgres por credencial.
 */
@Global()
@Module({
  controllers: [NodeTypesController],
  providers: [
    {
      provide: HTTP_GUARD,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createHttpGuard({ allowlist: config.http.allowlist }),
    },
    {
      provide: POOL_MANAGER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const logger = new Logger('PostgresPools');
        return new PoolManager({
          max: config.postgres.poolMax,
          onError: (err) => {
            logger.warn(`Conexão de pool Postgres perdida: ${err.message}`);
          },
        });
      },
    },
    {
      provide: CREDENTIAL_TYPES,
      inject: [APP_CONFIG],
      // Spec 011, FR-016: o modelo simulado (`fakeLlm`) só existe nos testes.
      useFactory: (config: AppConfig) =>
        new CredentialTypeRegistry(
          config.env === 'test'
            ? [...builtinCredentialTypes, fakeLlmCredential]
            : builtinCredentialTypes,
        ),
    },
    {
      provide: NODE_REGISTRY,
      inject: [APP_CONFIG, HTTP_GUARD, POOL_MANAGER],
      useFactory: (config: AppConfig, httpGuard: HttpGuard, pools: PoolManager) =>
        createNodeRegistry(
          createBuiltinNodes({
            httpGuard,
            httpMaxResponseBytes: config.http.maxResponseBytes,
            pools,
          }),
        ),
    },
  ],
  exports: [NODE_REGISTRY, CREDENTIAL_TYPES, HTTP_GUARD, POOL_MANAGER],
})
export class NodeTypesModule implements OnApplicationShutdown {
  constructor(
    @Inject(HTTP_GUARD) private readonly guard: HttpGuard,
    @Inject(POOL_MANAGER) private readonly pools: PoolManager,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.pools.closeAll(), this.guard.close()]);
  }
}
