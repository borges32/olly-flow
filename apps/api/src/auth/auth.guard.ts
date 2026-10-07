import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestWithUser } from './current-user.decorator.js';
import { Authenticator } from './authenticator.js';
import { IS_PUBLIC } from './public.decorator.js';
import { PasswordChangeRequiredError } from '../common/errors.js';

const BEARER = /^Bearer\s+(\S+)$/i;

/** Rotas liberadas enquanto a sessão local precisa trocar a senha (spec 014, FR-007). */
const PASSWORD_CHANGE_ROUTES = new Set([
  'GET /api/v1/me',
  'PUT /api/v1/auth/password',
  'POST /api/v1/auth/logout',
]);
const routeKey = (req: { method: string; url: string }) =>
  `${req.method.toUpperCase()} ${req.url.split('?')[0] ?? ''}`;

/** Guard global (FR-004): toda rota exige access token válido, salvo as marcadas com `@Public()`. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(Authenticator) private readonly authenticator: Authenticator,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    request.user = (await this.authenticator.authenticate(token)).user;
    // Spec 014 (FR-007): com a troca de senha pendente, só o necessário para trocá-la.
    if (request.user.mustChangePassword && !PASSWORD_CHANGE_ROUTES.has(routeKey(request))) {
      throw new PasswordChangeRequiredError('Troque a senha para continuar');
    }
    return true;
  }
}
