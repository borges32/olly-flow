import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@olly/db';
import { DB } from '../core/tokens.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResourceKind = 'project' | 'workflow' | 'execution' | 'credential' | 'publishRequest';

/** Resolve o projeto dono de um recurso. Novos tipos (credencial...) entram aqui. */
@Injectable()
export class ResourceResolver {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** `null` quando o recurso não existe (ou foi excluído). */
  async projectIdFor(kind: ResourceKind, id: string): Promise<string | null> {
    if (!UUID.test(id)) return null;
    if (kind === 'project') {
      const row = await this.db
        .selectFrom('projects')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      return row?.id ?? null;
    }
    if (kind === 'credential') {
      const row = await this.db
        .selectFrom('credentials')
        .select('project_id')
        .where('id', '=', id)
        .executeTakeFirst();
      return row?.project_id ?? null;
    }
    if (kind === 'publishRequest') {
      const row = await this.db
        .selectFrom('publish_requests')
        .select('project_id')
        .where('id', '=', id)
        .executeTakeFirst();
      return row?.project_id ?? null;
    }
    if (kind === 'execution') {
      const row = await this.db
        .selectFrom('executions')
        .select('project_id')
        .where('id', '=', id)
        .limit(1)
        .executeTakeFirst();
      return row?.project_id ?? null;
    }
    const row = await this.db
      .selectFrom('workflows')
      .select('project_id')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row?.project_id ?? null;
  }
}
