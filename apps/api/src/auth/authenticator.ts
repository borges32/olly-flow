import { Inject, Injectable } from '@nestjs/common';
import type { User } from '@olly/db';
import { PermissionDeniedError, UnauthenticatedError } from '../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { LOCAL_TOKEN_PREFIX, LocalSessionService } from './local-session.service.js';
import type { AccessTokenClaims, AuthenticatedUser } from './auth.types.js';
import { PERMISSION_RESOLVER, type PermissionResolver } from './permission-resolver.js';
import { OidcTokenVerifier } from './token-verifier.js';
import { UserSyncService } from './user-sync.service.js';

export interface Authentication {
  user: AuthenticatedUser;
  account: User;
  claims: AccessTokenClaims;
}

/**
 * Valida o token, sincroniza o usuário e calcula as permissões (HTTP e WebSocket).
 *
 * Spec 014 (plan §2, §5): token com o prefixo de sessão local é validado no banco; os demais são
 * tokens OIDC, aceitos só com o IdP ligado (`OLLY_IDP_ENABLED`).
 */
@Injectable()
export class Authenticator {
  constructor(
    @Inject(OidcTokenVerifier) private readonly verifier: OidcTokenVerifier,
    @Inject(UserSyncService) private readonly userSync: UserSyncService,
    @Inject(PERMISSION_RESOLVER) private readonly permissions: PermissionResolver,
    @Inject(LocalSessionService) private readonly sessions: LocalSessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async authenticate(token: string | undefined): Promise<Authentication> {
    if (!token) throw new UnauthenticatedError('Token de acesso ausente');
    if (token.startsWith(LOCAL_TOKEN_PREFIX)) {
      const session = await this.sessions.validate(token);
      if (!session) throw new UnauthenticatedError('Sessão inválida ou expirada; entre de novo');
      const account = session.user;
      const claims: AccessTokenClaims = {
        sub: `local:${account.id}`,
        email: account.email,
        groups: [],
      };
      return {
        user: await this.toUser(account, claims, session.sessionId),
        account,
        claims,
      };
    }
    if (!this.config.auth.idpEnabled) {
      throw new UnauthenticatedError('Login pelo IdP desativado; entre com e-mail e senha');
    }
    const claims = await this.verifier.verify(token);
    const account = await this.userSync.sync(claims);
    if (!account.is_active) throw new PermissionDeniedError('Usuário inativo');
    return { user: await this.toUser(account, claims), account, claims };
  }

  /** Recalcula as permissões (ex.: a cada `join` de sala no WebSocket). */
  async toUser(
    account: User,
    claims: AccessTokenClaims,
    sessionId?: string,
  ): Promise<AuthenticatedUser> {
    const { isAdmin, permissions } = await this.permissions.resolve(account, claims);
    const local = claims.sub.startsWith('local:');
    return {
      id: account.id,
      externalId: claims.sub,
      email: account.email,
      name: account.name,
      isAdmin,
      permissions,
      authMethod: local ? 'local' : 'idp',
      ...(sessionId && { sessionId }),
      mustChangePassword: local && account.must_change_password,
    };
  }
}
