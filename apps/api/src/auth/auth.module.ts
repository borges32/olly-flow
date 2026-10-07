import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { Authenticator } from './authenticator.js';
import { AbilityFactory } from '../rbac/ability.factory.js';
import { PermissionGuard } from '../rbac/permission.guard.js';
import { ResourceResolver } from '../rbac/resource-resolver.js';
import { PERMISSION_RESOLVER, ProjectPermissionResolver } from './permission-resolver.js';
import { OidcTokenVerifier } from './token-verifier.js';
import { UserSyncService } from './user-sync.service.js';
import { IdpGroupSync } from './idp-group-sync.js';
import { LocalSessionService } from './local-session.service.js';

@Module({
  providers: [
    OidcTokenVerifier,
    UserSyncService,
    IdpGroupSync,
    LocalSessionService,
    Authenticator,
    AbilityFactory,
    ResourceResolver,
    { provide: PERMISSION_RESOLVER, useClass: ProjectPermissionResolver },
    // A ordem importa: autentica primeiro, depois autoriza.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [
    OidcTokenVerifier,
    Authenticator,
    AbilityFactory,
    ResourceResolver,
    UserSyncService,
    IdpGroupSync,
    LocalSessionService,
  ],
})
export class AuthModule {}
