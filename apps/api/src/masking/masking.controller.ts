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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { MaskingRule } from '@olly/shared-types';
import type { AuditContext } from '../audit/audit.service.js';
import { Audit } from '../common/audit-context.decorator.js';
import { NotFoundError } from '../common/errors.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { maskingRuleSchema, type MaskingRuleBody } from './masking.schemas.js';
import { MaskingService } from './masking.service.js';

const ruleIdPipe = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundError('Regra de mascaramento não encontrada'),
});

/**
 * Regras de mascaramento (spec 009, FR-016): as globais são da administração da plataforma; as
 * de projeto, de quem administra o projeto.
 */
@ApiTags('governança')
@ApiBearerAuth()
@Controller()
export class MaskingController {
  constructor(@Inject(MaskingService) private readonly masking: MaskingService) {}

  @RequirePermission('project:manage', 'global')
  @Get('masking-rules')
  listGlobal(): Promise<MaskingRule[]> {
    return this.masking.list(null);
  }

  @RequirePermission('project:manage', 'global')
  @Post('masking-rules')
  createGlobal(
    @Audit() audit: AuditContext,
    @Body(new ZodPipe(maskingRuleSchema)) body: MaskingRuleBody,
  ): Promise<MaskingRule> {
    return this.masking.create(audit, null, body);
  }

  @RequirePermission('project:manage', 'global')
  @Put('masking-rules/:ruleId')
  updateGlobal(
    @Audit() audit: AuditContext,
    @Param('ruleId', ruleIdPipe) ruleId: string,
    @Body(new ZodPipe(maskingRuleSchema)) body: MaskingRuleBody,
  ): Promise<MaskingRule> {
    return this.masking.update(audit, null, ruleId, body);
  }

  @RequirePermission('project:manage', 'global')
  @HttpCode(204)
  @Delete('masking-rules/:ruleId')
  async removeGlobal(
    @Audit() audit: AuditContext,
    @Param('ruleId', ruleIdPipe) ruleId: string,
  ): Promise<void> {
    await this.masking.remove(audit, null, ruleId);
  }

  /** Regras que valem no projeto: as globais (somente leitura aqui) e as do projeto. */
  @RequirePermission('project:manage', { project: 'id' })
  @Get('projects/:id/masking-rules')
  listProject(@Param('id') id: string): Promise<MaskingRule[]> {
    return this.masking.list(id);
  }

  @RequirePermission('project:manage', { project: 'id' })
  @Post('projects/:id/masking-rules')
  createProject(
    @Audit() audit: AuditContext,
    @Param('id') id: string,
    @Body(new ZodPipe(maskingRuleSchema)) body: MaskingRuleBody,
  ): Promise<MaskingRule> {
    return this.masking.create(audit, id, body);
  }

  @RequirePermission('project:manage', { project: 'id' })
  @Put('projects/:id/masking-rules/:ruleId')
  updateProject(
    @Audit() audit: AuditContext,
    @Param('id') id: string,
    @Param('ruleId', ruleIdPipe) ruleId: string,
    @Body(new ZodPipe(maskingRuleSchema)) body: MaskingRuleBody,
  ): Promise<MaskingRule> {
    return this.masking.update(audit, id, ruleId, body);
  }

  @RequirePermission('project:manage', { project: 'id' })
  @HttpCode(204)
  @Delete('projects/:id/masking-rules/:ruleId')
  async removeProject(
    @Audit() audit: AuditContext,
    @Param('id') id: string,
    @Param('ruleId', ruleIdPipe) ruleId: string,
  ): Promise<void> {
    await this.masking.remove(audit, id, ruleId);
  }
}
