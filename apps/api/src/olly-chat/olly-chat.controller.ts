import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type {
  OllyChatConfig,
  OllyChatConfigUpdate,
  OllyChatMessage,
  OllyChatSession,
  OllyChatStatus,
} from '@olly/shared-types';
import type { FastifyReply } from 'fastify';
import type { AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Authenticated } from '../auth/public.decorator.js';
import { Audit } from '../common/audit-context.decorator.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { OllyChatConfigService } from './olly-chat-config.service.js';
import {
  ollyChatConfigSchema,
  ollyChatMessageSchema,
  ollyChatRenameSchema,
  type OllyChatMessageBody,
  type OllyChatRenameBody,
} from './olly-chat.schemas.js';
import { OllyChatService } from './olly-chat.service.js';

/**
 * Chat da plataforma (spec 028): sessões de qualquer usuário autenticado (só as próprias) e a
 * configuração, da administração da plataforma.
 */
@ApiTags('chat-olly')
@ApiBearerAuth()
@Controller()
export class OllyChatController {
  constructor(
    @Inject(OllyChatService) private readonly chat: OllyChatService,
    @Inject(OllyChatConfigService) private readonly settings: OllyChatConfigService,
  ) {}

  @Authenticated()
  @Get('olly-chat/status')
  status(): Promise<OllyChatStatus> {
    return this.chat.status();
  }

  @Authenticated()
  @Get('olly-chat/sessions')
  list(@CurrentUser() user: AuthenticatedUser): Promise<OllyChatSession[]> {
    return this.chat.list(user);
  }

  @Authenticated()
  @Post('olly-chat/sessions')
  create(@CurrentUser() user: AuthenticatedUser): Promise<OllyChatSession> {
    return this.chat.create(user);
  }

  @Authenticated()
  @HttpCode(204)
  @Patch('olly-chat/sessions/:id')
  async rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodPipe(ollyChatRenameSchema)) body: OllyChatRenameBody,
  ): Promise<void> {
    await this.chat.rename(user, id, body.title);
  }

  @Authenticated()
  @HttpCode(204)
  @Delete('olly-chat/sessions/:id')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.chat.remove(user, id);
  }

  @Authenticated()
  @Get('olly-chat/sessions/:id/messages')
  messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<OllyChatMessage[]> {
    return this.chat.messages(user, id);
  }

  /** Responde em NDJSON (formato da spec 027): passos do workflow e a resposta no fim. */
  @Authenticated()
  @Post('olly-chat/sessions/:id/messages')
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodPipe(ollyChatMessageSchema)) body: OllyChatMessageBody,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.chat.send(reply, user, id, body.message);
  }

  @RequirePermission('project:manage', 'global')
  @Get('admin/olly-chat')
  config(): Promise<OllyChatConfig> {
    return this.settings.get();
  }

  @RequirePermission('project:manage', 'global')
  @Put('admin/olly-chat')
  update(
    @Audit() audit: AuditContext,
    @Body(new ZodPipe(ollyChatConfigSchema)) body: OllyChatConfigUpdate,
  ): Promise<OllyChatConfig> {
    return this.settings.update(audit, body);
  }
}
