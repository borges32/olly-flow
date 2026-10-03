import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { UnauthenticatedError } from '../common/errors.js';
import type { AuthenticatedUser } from './auth.types.js';

export type RequestWithUser = FastifyRequest & { user?: AuthenticatedUser };

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<RequestWithUser>().user;
  if (!user) throw new UnauthenticatedError('Usuário não autenticado');
  return user;
});
