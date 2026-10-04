import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestWithUser } from './current-user.decorator.js';
import { Authenticator } from './authenticator.js';
import { IS_PUBLIC } from './public.decorator.js';

const BEARER = /^Bearer\s+(\S+)$/i;

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
    return true;
  }
}
