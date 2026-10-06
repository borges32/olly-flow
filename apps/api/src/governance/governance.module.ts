import { Module } from '@nestjs/common';
import { AuditController } from '../audit/audit.controller.js';
import { AuditQueryService } from '../audit/audit-query.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { MaskingController } from '../masking/masking.controller.js';
import { SsoController } from '../sso/sso.controller.js';
import { SsoService } from '../sso/sso.service.js';

/**
 * Governança da spec 009 na API: SSO e usuários, regras de mascaramento e auditoria. A
 * retenção roda no worker (`MaintenanceModule`).
 */
@Module({
  imports: [AuthModule],
  controllers: [SsoController, MaskingController, AuditController],
  providers: [SsoService, AuditQueryService],
})
export class GovernanceModule {}
