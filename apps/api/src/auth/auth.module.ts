import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { GroupPermissionResolver, PERMISSION_RESOLVER } from './permission-resolver.js';
import { OidcTokenVerifier } from './token-verifier.js';
import { UserSyncService } from './user-sync.service.js';

@Module({
  providers: [
    OidcTokenVerifier,
    UserSyncService,
    { provide: PERMISSION_RESOLVER, useClass: GroupPermissionResolver },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [OidcTokenVerifier],
})
export class AuthModule {}
