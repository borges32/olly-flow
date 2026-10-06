import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { GroupRoleMapping, LoginResponse, UserAdminSummary } from '@olly/shared-types';
import { ROLE_NAMES } from '@olly/shared-types';
import { z } from 'zod';
import type { AuditContext } from '../audit/audit.service.js';
import type { RequestWithUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { Audit } from '../common/audit-context.decorator.js';
import { NotFoundError } from '../common/errors.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { SsoService } from './sso.service.js';

const BEARER = /^Bearer\s+(\S+)$/i;
const uuid = (what: string) =>
  new ParseUUIDPipe({ exceptionFactory: () => new NotFoundError(`${what} não encontrado`) });

const mappingSchema = z.object({
  idpGroup: z.string().trim().min(1).max(256),
  projectId: z.uuid().nullable(),
  role: z.enum(ROLE_NAMES),
});
const activeSchema = z.object({ active: z.boolean() });

@ApiTags('SSO e usuários')
@ApiBearerAuth()
@Controller()
export class SsoController {
  constructor(@Inject(SsoService) private readonly sso: SsoService) {}

  /**
   * FR-005/FR-007: chamado pelo frontend logo após o login no IdP. Público porque registra
   * também as falhas (token inválido, usuário inativo); o token é validado aqui.
   */
  @Public()
  @HttpCode(200)
  @Post('auth/login')
  login(@Req() req: RequestWithUser): Promise<LoginResponse> {
    const token = BEARER.exec(req.headers.authorization ?? '')?.[1];
    return this.sso.login(token, req.ip || null);
  }

  @RequirePermission('user:manage', 'global')
  @Get('admin/users')
  users(): Promise<UserAdminSummary[]> {
    return this.sso.listUsers();
  }

  /** FR-006: reativação de usuário inativado (ou desativação manual). */
  @RequirePermission('user:manage', 'global')
  @HttpCode(204)
  @Put('admin/users/:userId/active')
  async setActive(
    @Audit() audit: AuditContext,
    @Param('userId', uuid('Usuário')) userId: string,
    @Body(new ZodPipe(activeSchema)) body: { active: boolean },
  ): Promise<void> {
    await this.sso.setActive(audit, userId, body.active);
  }

  @RequirePermission('user:manage', 'global')
  @Get('sso/group-mappings')
  mappings(): Promise<GroupRoleMapping[]> {
    return this.sso.listMappings();
  }

  @RequirePermission('user:manage', 'global')
  @Post('sso/group-mappings')
  createMapping(
    @Audit() audit: AuditContext,
    @Body(new ZodPipe(mappingSchema)) body: z.infer<typeof mappingSchema>,
  ): Promise<GroupRoleMapping> {
    return this.sso.createMapping(audit, body);
  }

  @RequirePermission('user:manage', 'global')
  @HttpCode(204)
  @Delete('sso/group-mappings/:mappingId')
  async deleteMapping(
    @Audit() audit: AuditContext,
    @Param('mappingId', uuid('Mapeamento')) mappingId: string,
  ): Promise<void> {
    await this.sso.deleteMapping(audit, mappingId);
  }
}
