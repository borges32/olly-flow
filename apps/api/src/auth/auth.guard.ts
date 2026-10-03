import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionDeniedError, UnauthenticatedError } from '../common/errors.js';
import type { RequestWithUser } from './current-user.decorator.js';
import { PERMISSION_RESOLVER, type PermissionResolver } from './permission-resolver.js';
import { IS_PUBLIC } from './public.decorator.js';
import { OidcTokenVerifier } from './token-verifier.js';
import { UserSyncService } from './user-sync.service.js';

const BEARER = /^Bearer\s+(\S+)$/i;

/** Guard global (FR-004): toda rota exige access token válido, salvo as marcadas com `@Public()`. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(OidcTokenVerifier) private readonly verifier: OidcTokenVerifier,
    @Inject(UserSyncService) private readonly userSync: UserSyncService,
    @Inject(PERMISSION_RESOLVER) private readonly permissions: PermissionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw new UnauthenticatedError('Token de acesso ausente');

    const claims = await this.verifier.verify(token);
    const user = await this.userSync.sync(claims);
    if (!user.is_active) throw new PermissionDeniedError('Usuário inativo');

    request.user = {
      id: user.id,
      externalId: claims.sub,
      email: user.email,
      name: user.name,
      permissions: await this.permissions.resolve(user, claims),
    };
    return true;
  }
}
