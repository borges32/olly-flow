import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';

/** Gravação da auditoria (spec 002); consulta e exportação ficam no `GovernanceModule`. */
@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
