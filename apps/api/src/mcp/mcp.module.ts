import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CredentialsModule } from '../credentials/credentials.module.js';
import { McpCatalogService } from './mcp-catalog.service.js';
import { McpConnections } from './mcp-connections.service.js';
import { McpGatewayFactory } from './mcp-gateway.service.js';
import { McpController, McpOAuthController } from './mcp.controller.js';
import { McpOAuthService } from './mcp-oauth.service.js';

/**
 * Execução: conexões com os servidores MCP e o gateway entregue ao motor (spec 010). Usado pela
 * API (execução em processo) e pelos workers.
 */
@Module({
  imports: [AuditModule, CredentialsModule],
  providers: [McpConnections, McpGatewayFactory],
  exports: [McpConnections, McpGatewayFactory],
})
export class McpRuntimeModule {}

/** Catálogo, políticas, chamadas da execução e OAuth (rotas da API). */
@Module({
  imports: [AuditModule, AuthModule, CredentialsModule, McpRuntimeModule],
  controllers: [McpController, McpOAuthController],
  providers: [McpCatalogService, McpOAuthService],
})
export class McpModule {}
