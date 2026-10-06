import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@olly/db';
import type { AuditList, AuditRecord } from '@olly/shared-types';
import { UnprocessableError } from '../common/errors.js';
import { DB } from '../core/tokens.js';

export interface AuditFilter {
  userId?: string;
  /** Exata, ou prefixo terminado em `*` (ex.: `workflow.*`). */
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Uma célula CSV: aspas sempre; prefixo `'` contra injeção de fórmula em planilhas. */
function csvCell(value: unknown): string {
  let text =
    typeof value === 'string'
      ? value
      : value === null || value === undefined
        ? ''
        : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export const AUDIT_CSV_HEADER =
  ['id', 'data', 'usuario_id', 'usuario_email', 'acao', 'entidade', 'entidade_id', 'ip', 'detalhes']
    .map(csvCell)
    .join(',') + '\n';

export function auditCsvLine(r: AuditRecord): string {
  return (
    [
      r.id,
      r.createdAt,
      r.userId,
      r.userEmail,
      r.action,
      r.entityType,
      r.entityId,
      r.ip,
      r.details === null || r.details === undefined ? '' : JSON.stringify(r.details),
    ]
      .map(csvCell)
      .join(',') + '\n'
  );
}

/** Consulta e exportação da auditoria (spec 009, FR-018; plan §8). */
@Injectable()
export class AuditQueryService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Mais recentes primeiro, por cursor (id). */
  async list(filter: AuditFilter, limit: number, cursor?: string): Promise<AuditList> {
    if (cursor !== undefined && !/^\d+$/.test(cursor)) {
      throw new UnprocessableError('Cursor inválido');
    }
    const items = await this.page(filter, limit + 1, cursor);
    const more = items.length > limit;
    const page = more ? items.slice(0, limit) : items;
    return { items: page, nextCursor: more ? (page.at(-1)?.id ?? null) : null };
  }

  /**
   * SC-008: percorre tudo em lotes (paginação por chave), entregando cada lote ao consumidor
   * antes de buscar o próximo; a memória não cresce com o total de registros.
   */
  async *stream(filter: AuditFilter, batchSize = 1000): AsyncGenerator<AuditRecord[]> {
    let cursor: string | undefined;
    for (;;) {
      const batch = await this.page(filter, batchSize, cursor);
      if (batch.length === 0) return;
      yield batch;
      if (batch.length < batchSize) return;
      cursor = batch.at(-1)?.id;
    }
  }

  private async page(filter: AuditFilter, limit: number, cursor?: string): Promise<AuditRecord[]> {
    const action = filter.action;
    const rows = await this.db
      .selectFrom('audit_log as a')
      .leftJoin('users as u', 'u.id', 'a.user_id')
      .select([
        'a.id',
        'a.created_at',
        'a.user_id',
        'u.email as user_email',
        'a.action',
        'a.entity_type',
        'a.entity_id',
        'a.details',
        'a.ip',
      ])
      .$if(cursor !== undefined, (qb) => qb.where('a.id', '<', cursor as string))
      .$if(filter.userId !== undefined, (qb) => qb.where('a.user_id', '=', filter.userId as string))
      .$if(action !== undefined, (qb) =>
        action?.endsWith('*')
          ? qb.where('a.action', 'like', `${escapeLike(action.slice(0, -1))}%`)
          : qb.where('a.action', '=', action as string),
      )
      .$if(filter.entityType !== undefined, (qb) =>
        qb.where('a.entity_type', '=', filter.entityType as string),
      )
      .$if(filter.entityId !== undefined, (qb) =>
        qb.where('a.entity_id', '=', filter.entityId as string),
      )
      .$if(filter.from !== undefined, (qb) => qb.where('a.created_at', '>=', filter.from as Date))
      .$if(filter.to !== undefined, (qb) => qb.where('a.created_at', '<', filter.to as Date))
      .orderBy('a.id', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at.toISOString(),
      userId: r.user_id,
      userEmail: r.user_email,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      details: r.details ?? null,
      ip: r.ip,
    }));
  }
}
