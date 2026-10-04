import { Inject, Injectable } from '@nestjs/common';
import type { User } from '@olly/db';
import { PermissionDeniedError, UnauthenticatedError } from '../common/errors.js';
import type { AccessTokenClaims, AuthenticatedUser } from './auth.types.js';
import { PERMISSION_RESOLVER, type PermissionResolver } from './permission-resolver.js';
import { OidcTokenVerifier } from './token-verifier.js';
import { UserSyncService } from './user-sync.service.js';

export interface Authentication {
  user: AuthenticatedUser;
  account: User;
  claims: AccessTokenClaims;
}

/** Valida o token, sincroniza o usuário e calcula as permissões (HTTP e WebSocket). */
@Injectable()
export class Authenticator {
  constructor(
    @Inject(OidcTokenVerifier) private readonly verifier: OidcTokenVerifier,
    @Inject(UserSyncService) private readonly userSync: UserSyncService,
    @Inject(PERMISSION_RESOLVER) private readonly permissions: PermissionResolver,
  ) {}

  async authenticate(token: string | undefined): Promise<Authentication> {
    if (!token) throw new UnauthenticatedError('Token de acesso ausente');
    const claims = await this.verifier.verify(token);
    const account = await this.userSync.sync(claims);
    if (!account.is_active) throw new PermissionDeniedError('Usuário inativo');
    return { user: await this.toUser(account, claims), account, claims };
  }

  /** Recalcula as permissões (ex.: a cada `join` de sala no WebSocket). */
  async toUser(account: User, claims: AccessTokenClaims): Promise<AuthenticatedUser> {
    const { isAdmin, permissions } = await this.permissions.resolve(account, claims);
    return {
      id: account.id,
      externalId: claims.sub,
      email: account.email,
      name: account.name,
      isAdmin,
      permissions,
    };
  }
}
