import { Body, Controller, Get, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ImportPreview, WorkflowDetail, WorkflowFile } from '@olly/shared-types';
import type { FastifyReply } from 'fastify';
import type { AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentProjectId, CurrentUser } from '../auth/current-user.decorator.js';
import { Audit } from '../common/audit-context.decorator.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import {
  exportBodySchema,
  importBodySchema,
  type ExportBody,
  type ImportBody,
} from './workflow-io.schemas.js';
import { WorkflowIoService } from './workflow-io.service.js';

/** Nome do arquivo baixado: o do workflow, com fallback ASCII e a forma UTF-8 (RFC 6266). */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Spec 015: baixar (Editor e Admin) e importar (Olly Flow ou N8N) workflows em JSON. */
@ApiTags('workflows')
@ApiBearerAuth()
@Controller()
export class WorkflowIoController {
  constructor(@Inject(WorkflowIoService) private readonly io: WorkflowIoService) {}

  /** FR-011: prévia (contagens, erros, pendências e, no N8N, o relatório de migração). */
  @RequirePermission('workflow:create', { project: 'id' })
  @HttpCode(200)
  @Post('projects/:id/workflows/import/preview')
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProjectId() projectId: string,
    @Body(new ZodPipe(importBodySchema)) body: ImportBody,
  ): Promise<ImportPreview> {
    return this.io.preview(user, projectId, body);
  }

  /** FR-010/FR-017: cria o rascunho no projeto. */
  @RequirePermission('workflow:create', { project: 'id' })
  @Post('projects/:id/workflows/import')
  import(
    @Audit() audit: AuditContext,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProjectId() projectId: string,
    @Body(new ZodPipe(importBodySchema)) body: ImportBody,
  ): Promise<{ workflow: WorkflowDetail; preview: ImportPreview }> {
    return this.io.import(audit, user, projectId, body);
  }

  /** FR-006/FR-008: o rascunho salvo, como arquivo. */
  @RequirePermission('workflow:update', { workflow: 'id' })
  @Get('workflows/:id/export')
  async exportSaved(
    @Audit() audit: AuditContext,
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<WorkflowFile> {
    const { file, filename } = await this.io.exportSaved(audit, id);
    void reply.header('content-disposition', contentDisposition(filename));
    return file;
  }

  /** FR-006/FR-008: o conteúdo do canvas (inclusive não salvo), como arquivo. */
  @RequirePermission('workflow:update', { workflow: 'id' })
  @HttpCode(200)
  @Post('workflows/:id/export')
  async exportCanvas(
    @Audit() audit: AuditContext,
    @Param('id') id: string,
    @Body(new ZodPipe(exportBodySchema)) body: ExportBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<WorkflowFile> {
    const { file, filename } = await this.io.exportCanvas(audit, id, body);
    void reply.header('content-disposition', contentDisposition(filename));
    return file;
  }
}
