import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ChatTestReply, ChatTestStart } from '@olly/shared-types';
import type { AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Audit } from '../common/audit-context.decorator.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { chatTestSchema, type ChatTestBody } from './chat.schemas.js';
import { ChatService } from './chat.service.js';

/**
 * Painel de chat do editor (spec 021, FR-002, plan §5): a mensagem inicia uma execução de teste
 * (o editor acompanha pelos eventos em tempo real) e a resposta é buscada em seguida.
 */
@ApiTags('chat')
@ApiBearerAuth()
@Controller()
export class ChatController {
  constructor(@Inject(ChatService) private readonly chat: ChatService) {}

  @RequirePermission('workflow:execute', { workflow: 'id' })
  @HttpCode(202)
  @Post('workflows/:id/chat/test')
  start(
    @Audit() audit: AuditContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodPipe(chatTestSchema)) body: ChatTestBody,
  ): Promise<ChatTestStart> {
    return this.chat.startTest(audit, user, id, body);
  }

  @RequirePermission('workflow:execute', { workflow: 'id' })
  @Get('workflows/:id/chat/test/:executionId/reply')
  reply(
    @Param('id') id: string,
    @Param('executionId') executionId: string,
  ): Promise<ChatTestReply> {
    return this.chat.testReply(id, executionId);
  }
}
