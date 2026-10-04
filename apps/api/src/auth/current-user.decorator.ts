import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { UnauthenticatedError } from '../common/errors.js';
import type { AuthenticatedUser } from './auth.types.js';

export type RequestWithUser = FastifyRequest & {
  user?: AuthenticatedUser;
  /** Projeto do recurso da rota, resolvido pelo `PermissionGuard`. */
  projectId?: string;
};

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<RequestWithUser>().user;
  if (!user) throw new UnauthenticatedError('Usuário não autenticado');
  return user;
});

/** Projeto resolvido pelo `PermissionGuard` para a rota atual. */
export const CurrentProjectId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const projectId = ctx.switchToHttp().getRequest<RequestWithUser>().projectId;
  if (!projectId) throw new Error('Rota sem @RequirePermission de projeto');
  return projectId;
});
