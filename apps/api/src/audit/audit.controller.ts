import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuditList } from '@olly/shared-types';
import type { FastifyReply } from 'fastify';
import { once } from 'node:events';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import {
  AUDIT_CSV_HEADER,
  AuditQueryService,
  auditCsvLine,
  type AuditFilter,
} from './audit-query.service.js';

const filterSchema = z.object({
  userId: z.uuid().optional(),
  action: z.string().trim().min(1).max(200).optional(),
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: z.string().trim().min(1).max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
const listSchema = filterSchema.extend({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
type ListQuery = z.infer<typeof listSchema>;

const filterOf = (q: z.infer<typeof filterSchema>): AuditFilter => q;

/** Auditoria (spec 009, FR-018): consulta e exportação, só com `audit:read`. */
@ApiTags('governança')
@ApiBearerAuth()
@Controller()
export class AuditController {
  constructor(@Inject(AuditQueryService) private readonly audit: AuditQueryService) {}

  @RequirePermission('audit:read', 'global')
  @Get('audit')
  list(@Query(new ZodPipe(listSchema)) query: ListQuery): Promise<AuditList> {
    const { cursor, limit, ...filter } = query;
    return this.audit.list(filterOf(filter), limit, cursor);
  }

  /** SC-008: CSV em *streaming*, lote a lote, respeitando a contrapressão da conexão. */
  @RequirePermission('audit:read', 'global')
  @Get('audit/export.csv')
  async export(
    @Query(new ZodPipe(filterSchema)) query: z.infer<typeof filterSchema>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="auditoria-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    });
    // BOM: o Excel reconhece o UTF-8 (acentos).
    raw.write(`\uFEFF${AUDIT_CSV_HEADER}`);
    try {
      for await (const batch of this.audit.stream(filterOf(query))) {
        if (raw.destroyed) return;
        if (!raw.write(batch.map(auditCsvLine).join(''))) await once(raw, 'drain');
      }
    } finally {
      raw.end();
    }
  }
}
