import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { auditContext } from '../audit/audit.service.js';
import type { RequestWithUser } from '../auth/current-user.decorator.js';

/** Quem e de onde, para o registro de auditoria. */
export const Audit = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  auditContext(ctx.switchToHttp().getRequest<RequestWithUser>()),
);
