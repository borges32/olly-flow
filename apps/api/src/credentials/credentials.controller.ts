import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CredentialSummary, CredentialTestResponse, PostgresColumn } from '@olly/shared-types';
import type { AuditContext } from '../audit/audit.service.js';
import { CurrentProjectId } from '../auth/current-user.decorator.js';
import { Audit } from '../common/audit-context.decorator.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import {
  columnsQuerySchema,
  createCredentialSchema,
  tablesQuerySchema,
  testCredentialSchema,
  updateCredentialSchema,
  type CreateCredentialBody,
  type TestCredentialBody,
  type UpdateCredentialBody,
} from './credentials.schemas.js';
import { CredentialsService } from './credentials.service.js';

/** Credenciais (spec 004, plan §2): uso exige `credential:use`; gestão, `credential:manage`. */
@ApiTags('credenciais')
@ApiBearerAuth()
@Controller()
export class CredentialsController {
  constructor(@Inject(CredentialsService) private readonly credentials: CredentialsService) {}

  @RequirePermission('credential:use', { project: 'id' })
  @Get('projects/:id/credentials')
  list(@CurrentProjectId() projectId: string): Promise<CredentialSummary[]> {
    return this.credentials.list(projectId);
  }

  @RequirePermission('credential:manage', { project: 'id' })
  @Post('projects/:id/credentials')
  create(
    @Audit() audit: AuditContext,
    @CurrentProjectId() projectId: string,
    @Body(new ZodPipe(createCredentialSchema)) body: CreateCredentialBody,
  ): Promise<CredentialSummary> {
    return this.credentials.create(audit, projectId, body);
  }

  @RequirePermission('credential:use', { credential: 'id' })
  @Get('credentials/:id')
  get(@Param('id') id: string): Promise<CredentialSummary> {
    return this.credentials.get(id);
  }

  @RequirePermission('credential:manage', { credential: 'id' })
  @Put('credentials/:id')
  update(
    @Audit() audit: AuditContext,
    @Param('id') id: string,
    @Body(new ZodPipe(updateCredentialSchema)) body: UpdateCredentialBody,
  ): Promise<CredentialSummary> {
    return this.credentials.update(audit, id, body);
  }

  @RequirePermission('credential:manage', { credential: 'id' })
  @HttpCode(204)
  @Delete('credentials/:id')
  async delete(@Audit() audit: AuditContext, @Param('id') id: string): Promise<void> {
    await this.credentials.delete(audit, id);
  }

  @RequirePermission('credential:manage', { credential: 'id' })
  @HttpCode(200)
  @Post('credentials/:id/test')
  test(
    @Audit() audit: AuditContext,
    @Param('id') id: string,
    @Body(new ZodPipe(testCredentialSchema)) body: TestCredentialBody,
  ): Promise<CredentialTestResponse> {
    return this.credentials.test(audit, id, body);
  }

  @RequirePermission('credential:use', { credential: 'id' })
  @Get('credentials/:id/postgres/schemas')
  schemas(@Param('id') id: string): Promise<string[]> {
    return this.credentials.postgresSchemas(id);
  }

  @RequirePermission('credential:use', { credential: 'id' })
  @Get('credentials/:id/postgres/tables')
  tables(
    @Param('id') id: string,
    @Query(new ZodPipe(tablesQuerySchema)) query: { schema: string },
  ): Promise<string[]> {
    return this.credentials.postgresTables(id, query.schema);
  }

  @RequirePermission('credential:use', { credential: 'id' })
  @Get('credentials/:id/postgres/columns')
  columns(
    @Param('id') id: string,
    @Query(new ZodPipe(columnsQuerySchema)) query: { schema: string; table: string },
  ): Promise<PostgresColumn[]> {
    return this.credentials.postgresColumns(id, query.schema, query.table);
  }
}
