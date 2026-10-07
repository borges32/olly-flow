import { Module } from '@nestjs/common';
import { AuditController } from '../audit/audit.controller.js';
import { AuditQueryService } from '../audit/audit-query.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { LocalAuthController } from '../auth/local-auth.controller.js';
import { LocalAuthService } from '../auth/local-auth.service.js';
import { IdpConfigAudit } from '../auth/idp-config-audit.js';
import { MaskingController } from '../masking/masking.controller.js';
import { SsoController } from '../sso/sso.controller.js';
import { SsoService } from '../sso/sso.service.js';
import { UsersAdminService } from '../sso/users-admin.service.js';

/**
 * Governança da spec 009 na API: SSO e usuários, regras de mascaramento e auditoria. A
 * retenção roda no worker (`MaintenanceModule`).
 */
@Module({
  imports: [AuthModule],
  // Spec 014: primeiro usuário e login local.
  controllers: [SsoController, LocalAuthController, MaskingController, AuditController],
  providers: [SsoService, UsersAdminService, LocalAuthService, IdpConfigAudit, AuditQueryService],
})
export class GovernanceModule {}
