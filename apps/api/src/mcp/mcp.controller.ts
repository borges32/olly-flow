import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type {
  McpCall,
  McpOAuthAuthorizeResponse,
  McpOAuthStatus,
  McpServer,
  McpServerOption,
  McpServerTestResponse,
  McpToolView,
} from '@olly/shared-types';
import type { FastifyReply } from 'fastify';
import type { AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { Audit } from '../common/audit-context.decorator.js';
import { NotFoundError } from '../common/errors.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { hasProjectPermission } from '../rbac/ability.factory.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { ResourceResolver } from '../rbac/resource-resolver.js';
import { McpCatalogService } from './mcp-catalog.service.js';
import { McpOAuthService } from './mcp-oauth.service.js';
import {
  mcpListQuerySchema,
  mcpPoliciesSchema,
  mcpServerSchema,
  mcpToolsQuerySchema,
  oauthCallbackQuerySchema,
  type McpPoliciesBody,
  type McpServerBody,
} from './mcp.schemas.js';

const serverIdPipe = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundError('Servidor MCP não encontrado'),
});

/**
 * Catálogo MCP (spec 010, FR-001 a FR-003): administração da plataforma (`mcp:manage` global).
 * Para uso nos workflows, a listagem do projeto exige `credential:use` (plan §1).
 */
@ApiTags('MCP')
@ApiBearerAuth()
@Controller()
export class McpController {
  constructor(
    @Inject(McpCatalogService) private readonly catalog: McpCatalogService,
    @Inject(ResourceResolver) private readonly resources: ResourceResolver,
  ) {}

  @RequirePermission('mcp:manage', 'global')
  @Get('mcp-servers')
  list(
    @Query(new ZodPipe(mcpListQuerySchema)) query: { projectId?: string },
  ): Promise<McpServer[]> {
    return this.catalog.list(query.projectId);
  }

  @RequirePermission('mcp:manage', 'global')
  @Post('mcp-servers')
  create(
    @Audit() audit: AuditContext,
    @Body(new ZodPipe(mcpServerSchema)) body: McpServerBody,
  ): Promise<McpServer> {
    return this.catalog.create(audit, body);
  }

  @RequirePermission('mcp:manage', 'global')
  @Get('mcp-servers/:serverId')
  get(@Param('serverId', serverIdPipe) serverId: string): Promise<McpServer> {
    return this.catalog.get(serverId);
  }

  @RequirePermission('mcp:manage', 'global')
  @Put('mcp-servers/:serverId')
  update(
    @Audit() audit: AuditContext,
    @Param('serverId', serverIdPipe) serverId: string,
    @Body(new ZodPipe(mcpServerSchema)) body: McpServerBody,
  ): Promise<McpServer> {
    return this.catalog.update(audit, serverId, body);
  }

  @RequirePermission('mcp:manage', 'global')
  @HttpCode(204)
  @Delete('mcp-servers/:serverId')
  async remove(
    @Audit() audit: AuditContext,
    @Param('serverId', serverIdPipe) serverId: string,
  ): Promise<void> {
    await this.catalog.remove(audit, serverId);
  }

  @RequirePermission('mcp:manage', 'global')
  @HttpCode(200)
  @Post('mcp-servers/:serverId/test')
  test(
    @Audit() audit: AuditContext,
    @Param('serverId', serverIdPipe) serverId: string,
  ): Promise<McpServerTestResponse> {
    return this.catalog.test(audit, serverId);
  }

  @RequirePermission('mcp:manage', 'global')
  @HttpCode(200)
  @Post('mcp-servers/:serverId/approve')
  approve(
    @Audit() audit: AuditContext,
    @Param('serverId', serverIdPipe) serverId: string,
  ): Promise<McpServer> {
    return this.catalog.approve(audit, serverId);
  }

  @RequirePermission('mcp:manage', 'global')
  @HttpCode(200)
  @Post('mcp-servers/:serverId/disable')
  disable(
    @Audit() audit: AuditContext,
    @Param('serverId', serverIdPipe) serverId: string,
  ): Promise<McpServer> {
    return this.catalog.disable(audit, serverId);
  }

  @RequirePermission('mcp:manage', 'global')
  @Get('mcp-servers/:serverId/tools')
  tools(
    @Param('serverId', serverIdPipe) serverId: string,
    @Query(new ZodPipe(mcpToolsQuerySchema)) query: { projectId?: string },
  ): Promise<McpToolView[]> {
    return this.catalog.tools(serverId, query.projectId ?? null);
  }

  @RequirePermission('mcp:manage', 'global')
  @Put('mcp-servers/:serverId/policies')
  policies(
    @Audit() audit: AuditContext,
    @Param('serverId', serverIdPipe) serverId: string,
    @Body(new ZodPipe(mcpPoliciesSchema)) body: McpPoliciesBody,
  ): Promise<McpToolView[]> {
    return this.catalog.setPolicies(audit, serverId, body);
  }

  @RequirePermission('mcp:manage', 'global')
  @HttpCode(200)
  @Post('mcp-servers/:serverId/snapshot/accept')
  acceptSnapshot(
    @Audit() audit: AuditContext,
    @Param('serverId', serverIdPipe) serverId: string,
  ): Promise<McpServer> {
    return this.catalog.acceptSnapshot(audit, serverId);
  }

  /** Servidores e tools liberadas para os workflows do projeto (FR-009). */
  @RequirePermission('credential:use', { project: 'id' })
  @Get('projects/:id/mcp-servers')
  available(@Param('id') id: string): Promise<McpServerOption[]> {
    return this.catalog.available(id);
  }

  /** FR-011: chamadas MCP da execução; os argumentos (mascarados) exigem `execution:readData`. */
  @RequirePermission('execution:read', { execution: 'id' })
  @Get('executions/:id/mcp-calls')
  async calls(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<McpCall[]> {
    const projectId = await this.resources.projectIdFor('execution', id);
    const canReadData =
      projectId !== null && hasProjectPermission(user, 'execution:readData', projectId);
    return this.catalog.calls(id, canReadData);
  }
}

/** OAuth 2.1 dos servidores MCP (spec 010, FR-007). */
@ApiTags('MCP')
@ApiBearerAuth()
@Controller()
export class McpOAuthController {
  constructor(
    @Inject(McpOAuthService) private readonly oauth: McpOAuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @RequirePermission('credential:manage', { credential: 'id' })
  @HttpCode(200)
  @Post('credentials/:id/oauth/authorize')
  authorize(
    @Audit() audit: AuditContext,
    @Param('id') id: string,
  ): Promise<McpOAuthAuthorizeResponse> {
    return this.oauth.authorize(audit, id);
  }

  @RequirePermission('credential:use', { credential: 'id' })
  @Get('credentials/:id/oauth/status')
  status(@Param('id') id: string): Promise<McpOAuthStatus> {
    return this.oauth.status(id);
  }

  /**
   * Retorno do servidor de autorização (navegador). Público: a autorização vale pelo `state` de
   * uso único gerado no "Conectar" de quem tem `credential:manage`.
   */
  @Public()
  @Get('oauth/callback')
  async callback(@Query() raw: Record<string, unknown>, @Res() reply: FastifyReply): Promise<void> {
    const parsed = oauthCallbackQuerySchema.safeParse(raw);
    let ok = false;
    let text: string;
    if (!parsed.success) {
      text = 'Retorno de autorização inválido.';
    } else {
      try {
        await this.oauth.callback(parsed.data);
        ok = true;
        text = 'Servidor MCP conectado. Você já pode fechar esta janela.';
      } catch (error) {
        text = error instanceof Error ? error.message : String(error);
      }
    }
    const origin = new URL(this.config.publicUrl).origin;
    const payload = JSON.stringify({ type: 'olly-mcp-oauth', ok, message: text }).replace(
      /</g,
      '\\u003c',
    );
    await reply
      .status(ok ? 200 : 400)
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(
        `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Olly Flow</title></head>` +
          `<body><p>${escapeHtml(text)}</p><script>` +
          `if (window.opener) { window.opener.postMessage(${payload}, ${JSON.stringify(origin)}); ${ok ? 'window.close();' : ''} }` +
          `</script></body></html>`,
      );
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
