import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Db } from '@olly/db';
import type { Redis } from 'ioredis';
import { sql } from 'kysely';
import { AuditService } from '../audit/audit.service.js';
import { BINARY_STORAGE } from '../binary/binary.module.js';
import type { S3BinaryStorage } from '../binary/s3-binary-store.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB, REDIS } from '../core/tokens.js';
import { executionPrefix } from '../executions/node-data.js';

const DAY_MS = 86_400_000;
const LOCK_KEY = 'olly:retention-lock';
const LOCK_TTL_MS = 30 * 60_000;
const BATCH = 500;
/** Execuções que ainda podem mudar não são tocadas pela retenção. */
const FINAL_STATUSES = ['success', 'error', 'cancelled'];
const PARTITIONED = ['executions', 'node_executions'] as const;

export interface MaintenanceReport {
  /** `false`: outra instância estava rodando (lock). */
  ran: boolean;
  dataPurged: { executions: number; objects: number };
  /** `mcpCalls`: registro das chamadas MCP (spec 010), removido com os metadados. */
  metadataDeleted: { executions: number; nodes: number; objects: number; mcpCalls: number };
  /** Spec 011, FR-009: mensagens da memória persistente removidas pela retenção. */
  memoryDeleted: number;
  partitionsDropped: string[];
  usersInactivated: number;
  /** Spec 014: sessões locais expiradas ou revogadas há mais de 7 dias, apagadas. */
  sessionsDeleted: number;
}

interface StoredRetention {
  dataDays?: number | null;
  metadataDays?: number | null;
  memoryDays?: number | null;
}

/**
 * Job diário (spec 009, FR-006, FR-017; plan §2 e §7), protegido por lock no Redis:
 * 1. cria as partições futuras;
 * 2. por projeto, remove as execuções (metadados) mais antigas que `retention.metadataDays`;
 * 3. por projeto, remove os dados (entrada/saída, console, objetos no storage) das execuções
 *    mais antigas que `retention.dataDays`, e descarta as partições mensais inteiramente fora
 *    da maior retenção;
 * 4. marca como inativos os usuários sem login há `OLLY_USER_INACTIVE_DAYS`;
 * 5. registra as contagens na auditoria.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger('Maintenance');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BINARY_STORAGE) private readonly storage: S3BinaryStorage | null,
  ) {}

  async run(now = new Date()): Promise<MaintenanceReport> {
    const report: MaintenanceReport = {
      ran: false,
      dataPurged: { executions: 0, objects: 0 },
      metadataDeleted: { executions: 0, nodes: 0, objects: 0, mcpCalls: 0 },
      memoryDeleted: 0,
      partitionsDropped: [],
      usersInactivated: 0,
      sessionsDeleted: 0,
    };
    const token = randomUUID();
    const locked = await this.redis.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX');
    if (locked !== 'OK') {
      this.logger.log('Manutenção já em andamento em outra instância');
      return report;
    }
    report.ran = true;
    try {
      await sql`SELECT olly_ensure_partitions(2)`.execute(this.db);
      const projects = await this.db.selectFrom('projects').select(['id', 'retention']).execute();
      const defaults = this.config.governance.retention;
      let maxMetadataDays = defaults.metadataDays;
      for (const project of projects) {
        const retention = (project.retention ?? {}) as StoredRetention;
        const dataDays = retention.dataDays ?? defaults.dataDays;
        const metadataDays = retention.metadataDays ?? defaults.metadataDays;
        maxMetadataDays = Math.max(maxMetadataDays, metadataDays);
        await this.purgeMetadata(
          project.id,
          new Date(now.getTime() - metadataDays * DAY_MS),
          report,
        );
        await this.purgeData(project.id, new Date(now.getTime() - dataDays * DAY_MS), report);
        const memoryDays = retention.memoryDays ?? this.config.ai.memoryRetentionDays;
        const memory = await this.db
          .deleteFrom('agent_memory')
          .where('project_id', '=', project.id)
          .where('created_at', '<', new Date(now.getTime() - memoryDays * DAY_MS))
          .executeTakeFirst();
        report.memoryDeleted += Number(memory.numDeletedRows);
      }
      report.partitionsDropped = await this.dropPartitions(
        new Date(now.getTime() - maxMetadataDays * DAY_MS),
      );
      report.usersInactivated = await this.inactivateUsers(
        new Date(now.getTime() - this.config.governance.userInactiveDays * DAY_MS),
      );
      // Spec 014: sessões locais encerradas há mais de 7 dias não servem para mais nada.
      const sessionCutoff = new Date(now.getTime() - 7 * DAY_MS);
      const sessions = await this.db
        .deleteFrom('user_sessions')
        .where((eb) =>
          eb.or([eb('expires_at', '<', sessionCutoff), eb('revoked_at', '<', sessionCutoff)]),
        )
        .executeTakeFirst();
      report.sessionsDeleted = Number(sessions.numDeletedRows);
      await this.audit.record(
        this.db,
        { userId: null, ip: null },
        {
          action: 'retention.run',
          entityType: 'system',
          entityId: 'retention',
          details: { ...report, at: now.toISOString() },
        },
      );
      this.logger.log(`Manutenção concluída: ${JSON.stringify(report)}`);
      return report;
    } finally {
      // Só libera o próprio lock.
      await this.redis
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          LOCK_KEY,
          token,
        )
        .catch(() => undefined);
    }
  }

  /** Passo 3: dados das execuções antigas (os metadados ficam). */
  private async purgeData(projectId: string, cutoff: Date, report: MaintenanceReport) {
    for (;;) {
      const ids = await this.db
        .selectFrom('node_executions as ne')
        .innerJoin('executions as e', 'e.id', 'ne.execution_id')
        .select('ne.execution_id')
        .distinct()
        .where('e.project_id', '=', projectId)
        .where('e.started_at', '<', cutoff)
        .where('e.status', 'in', FINAL_STATUSES)
        .where((eb) =>
          eb.or([
            eb('ne.input_data', 'is not', null),
            eb('ne.output_data', 'is not', null),
            eb('ne.input_sources', 'is not', null),
            eb('ne.console', 'is not', null),
            eb('ne.data_ref', 'is not', null),
          ]),
        )
        .limit(BATCH)
        .execute();
      if (ids.length === 0) return;
      const executionIds = ids.map((r) => r.execution_id);
      report.dataPurged.objects += await this.deleteObjects(executionIds);
      await this.db
        .updateTable('node_executions')
        .set({
          input_data: null,
          output_data: null,
          input_sources: null,
          console: null,
          data_ref: null,
        })
        .where('execution_id', 'in', executionIds)
        .execute();
      await this.db
        .deleteFrom('execution_payloads')
        .where('execution_id', 'in', executionIds)
        .execute();
      // Spec 011: o conteúdo dos passos do agente é dado da execução (a linha fica).
      await this.db
        .updateTable('agent_steps')
        .set({ content: null })
        .where('execution_id', 'in', executionIds)
        .where('content', 'is not', null)
        .execute();
      report.dataPurged.executions += executionIds.length;
    }
  }

  /** Passo 2: execuções inteiras (metadados) do projeto. */
  private async purgeMetadata(projectId: string, cutoff: Date, report: MaintenanceReport) {
    for (;;) {
      const rows = await this.db
        .selectFrom('executions')
        .select('id')
        .where('project_id', '=', projectId)
        .where('started_at', '<', cutoff)
        .where('status', 'in', FINAL_STATUSES)
        .limit(BATCH)
        .execute();
      if (rows.length === 0) return;
      const ids = rows.map((r) => r.id);
      report.metadataDeleted.objects += await this.deleteObjects(ids);
      const nodes = await this.db
        .deleteFrom('node_executions')
        .where('execution_id', 'in', ids)
        .executeTakeFirst();
      await this.db.deleteFrom('execution_payloads').where('execution_id', 'in', ids).execute();
      const calls = await this.db
        .deleteFrom('mcp_calls')
        .where('execution_id', 'in', ids)
        .executeTakeFirst();
      report.metadataDeleted.mcpCalls += Number(calls.numDeletedRows);
      // Spec 011: passos do agente e pedidos de aprovação saem com a execução.
      await this.db.deleteFrom('agent_steps').where('execution_id', 'in', ids).execute();
      await this.db.deleteFrom('approval_requests').where('execution_id', 'in', ids).execute();
      await this.db.deleteFrom('executions').where('id', 'in', ids).execute();
      report.metadataDeleted.executions += ids.length;
      report.metadataDeleted.nodes += Number(nodes.numDeletedRows);
    }
  }

  /** Passo 3: partições mensais que terminam antes do corte de todos os projetos. */
  private async dropPartitions(cutoff: Date): Promise<string[]> {
    const dropped: string[] = [];
    for (const parent of PARTITIONED) {
      const { rows } = await sql<{ name: string }>`
        SELECT c.relname AS name FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = ${parent}`.execute(this.db);
      for (const { name } of rows) {
        const match = new RegExp(`^${parent}_(\\d{4})(\\d{2})$`).exec(name);
        if (!match) continue;
        const end = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
        if (end > cutoff) continue;
        // Os nomes vêm do catálogo e do padrão acima; mesmo assim, escapados como identificador.
        await sql`ALTER TABLE ${sql.table(parent)} DETACH PARTITION ${sql.table(name)}`.execute(
          this.db,
        );
        await sql`DROP TABLE ${sql.table(name)}`.execute(this.db);
        dropped.push(name);
      }
    }
    return dropped;
  }

  /** FR-006: sem login há N dias (ou nunca, desde a criação) → inativo. */
  private async inactivateUsers(cutoff: Date): Promise<number> {
    // Spec 014 (FR-009): se todos os administradores ativos estiverem sem login há tempo, o mais
    // recente fica ativo; a plataforma nunca fica sem administrador.
    const admins = await this.db
      .selectFrom('users')
      .select(['id', sql<Date>`coalesce(last_login_at, created_at)`.as('seen')])
      .where('is_active', '=', true)
      .where('is_admin', '=', true)
      .orderBy(sql`coalesce(last_login_at, created_at)`, 'desc')
      .execute();
    const keep =
      admins.length > 0 && admins.every((a) => a.seen < cutoff) ? admins[0]?.id : undefined;
    const rows = await this.db
      .updateTable('users')
      .set({ is_active: false })
      .where('is_active', '=', true)
      .where(sql<boolean>`coalesce(last_login_at, created_at) < ${cutoff}`)
      .$if(keep !== undefined, (q) => q.where('id', '!=', keep ?? ''))
      .returning(['id', 'email'])
      .execute();
    for (const user of rows) {
      await this.audit.record(
        this.db,
        { userId: null, ip: null },
        {
          action: 'user.inactivate',
          entityType: 'user',
          entityId: user.id,
          details: {
            email: user.email,
            reason: 'sem login',
            days: this.config.governance.userInactiveDays,
          },
        },
      );
    }
    return rows.length;
  }

  private async deleteObjects(executionIds: string[]): Promise<number> {
    if (!this.storage) return 0;
    let removed = 0;
    for (const id of executionIds) {
      try {
        removed += await this.storage.deletePrefix(executionPrefix(id));
      } catch (error) {
        this.logger.warn(`Objetos da execução ${id} não removidos: ${String(error)}`);
      }
    }
    return removed;
  }
}
