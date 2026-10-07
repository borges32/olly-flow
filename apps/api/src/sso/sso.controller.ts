import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { SsoService } from './sso.service.js';
import { UsersAdminService } from './users-admin.service.js';

const BEARER = /^Bearer\s+(\S+)$/i;
const uuid = (what: string) =>
  new ParseUUIDPipe({ exceptionFactory: () => new NotFoundError(`${what} não encontrado`) });

const mappingSchema = z.object({
  idpGroup: z.string().trim().min(1).max(256),
  projectId: z.uuid().nullable(),
  role: z.enum(ROLE_NAMES),
});
const activeSchema = z.object({ active: z.boolean() });
// Spec 014: senha no corpo limitada (o hash é caro); a política é aplicada no serviço.
const password = z.string().min(1).max(1024);
const createUserSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.email().max(320),
    password,
    isAdmin: z.boolean().optional(),
  })
  .strict();
const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    email: z.email().max(320).optional(),
    isAdmin: z.boolean().optional(),
  })
  .strict();
const resetPasswordSchema = z.object({ password }).strict();

@ApiTags('SSO e usuários')
@ApiBearerAuth()
@Controller()
export class SsoController {
  constructor(
    @Inject(SsoService) private readonly sso: SsoService,
    @Inject(UsersAdminService) private readonly usersAdmin: UsersAdminService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * FR-005/FR-007: chamado pelo frontend logo após o login no IdP. Público porque registra
   * também as falhas (token inválido, usuário inativo); o token é validado aqui.
   */
  @Public()
  @HttpCode(200)
  @Post('auth/login')
  login(@Req() req: RequestWithUser): Promise<LoginResponse> {
    // Spec 014 (FR-010): sem IdP, não há login OIDC a registrar.
    if (!this.config.auth.idpEnabled) throw new NotFoundError('Login pelo IdP desativado');
    const token = BEARER.exec(req.headers.authorization ?? '')?.[1];
    return this.sso.login(token, req.ip || null);
  }

  @RequirePermission('user:manage', 'global')
  @Get('admin/users')
  users(): Promise<UserAdminSummary[]> {
    return this.sso.listUsers();
  }

  /** FR-006 (spec 009) e FR-008/FR-009 (spec 014): ativa ou desativa, encerrando as sessões. */
  @RequirePermission('user:manage', 'global')
  @HttpCode(204)
  @Put('admin/users/:userId/active')
  async setActive(
    @Audit() audit: AuditContext,
    @Param('userId', uuid('Usuário')) userId: string,
    @Body(new ZodPipe(activeSchema)) body: { active: boolean },
  ): Promise<void> {
    await this.usersAdmin.setActive(audit, userId, body.active);
  }

  /** Spec 014 (FR-006): usuário local, com a senha inicial de troca obrigatória. */
  @RequirePermission('user:manage', 'global')
  @Post('admin/users')
  createUser(
    @Audit() audit: AuditContext,
    @Body(new ZodPipe(createUserSchema)) body: z.infer<typeof createUserSchema>,
  ): Promise<UserAdminSummary> {
    return this.usersAdmin.create(audit, body);
  }

  /** Spec 014 (FR-006, FR-009): nome, e-mail e administração global. */
  @RequirePermission('user:manage', 'global')
  @Patch('admin/users/:userId')
  updateUser(
    @Audit() audit: AuditContext,
    @Param('userId', uuid('Usuário')) userId: string,
    @Body(new ZodPipe(updateUserSchema)) body: z.infer<typeof updateUserSchema>,
  ): Promise<UserAdminSummary> {
    return this.usersAdmin.update(audit, userId, body);
  }

  /** Spec 014 (FR-006, FR-007): redefinição de senha pela administração. */
  @RequirePermission('user:manage', 'global')
  @HttpCode(204)
  @Put('admin/users/:userId/password')
  async resetPassword(
    @Audit() audit: AuditContext,
    @Param('userId', uuid('Usuário')) userId: string,
    @Body(new ZodPipe(resetPasswordSchema)) body: { password: string },
  ): Promise<void> {
    await this.usersAdmin.resetPassword(audit, userId, body.password);
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
