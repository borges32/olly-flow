import { Inject, Injectable } from '@nestjs/common';
import type { Db, McpServerRow } from '@olly/db';
import { blockedTools, snapshotTools, toolHash } from '@olly/mcp-client';
import type {
  McpCall,
  McpOperation,
  McpServer,
  McpServerInfo,
  McpServerOption,
  McpServerTestResponse,
  McpSnapshotDiff,
  McpToolDefinition,
  McpToolView,
  McpToolsSnapshot,
} from '@olly/shared-types';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../common/errors.js';
import { DB } from '../core/tokens.js';
import { McpConnections } from './mcp-connections.service.js';
import { effectivePolicies } from './mcp-gateway.service.js';
import type { McpPoliciesBody, McpServerBody } from './mcp.schemas.js';

const UNIQUE_VIOLATION = '23505';
const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toServer(row: McpServerRow): McpServer {
  const snapshot = (row.tools_snapshot ?? {}) as McpToolsSnapshot;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    transport: row.transport,
    url: row.url,
    credentialId: row.credential_id,
    projectId: row.project_id,
    status: row.status,
    serverInfo: (row.server_info ?? null) as McpServerInfo | null,
    pendingDiff: (row.snapshot_pending_diff ?? null) as McpSnapshotDiff | null,
    toolCount: Object.keys(snapshot).length,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    approvedAt: iso(row.approved_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Catálogo de servidores MCP (spec 010, FR-001 a FR-003; plan §1–§2): cadastro, teste,
 * aprovação com snapshot das tools, políticas por servidor e projeto e revisão de mudanças.
 * Gerido pela administração da plataforma (`mcp:manage` global).
 */
@Injectable()
export class McpCatalogService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(McpConnections) private readonly connections: McpConnections,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async load(id: string): Promise<McpServerRow> {
    const row = await this.db
      .selectFrom('mcp_servers')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new NotFoundError('Servidor MCP não encontrado');
    return row;
  }

  private conflict(error: unknown): never {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new ConflictError('Já existe um servidor MCP com esse nome neste escopo');
    }
    throw error;
  }

  private async checkReferences(body: McpServerBody): Promise<void> {
    if (body.projectId) {
      const project = await this.db
        .selectFrom('projects')
        .select('id')
        .where('id', '=', body.projectId)
        .executeTakeFirst();
      if (!project) throw new UnprocessableError('Projeto não encontrado');
    }
    if (body.credentialId) {
      const credential = await this.db
        .selectFrom('credentials')
        .select(['type', 'project_id'])
        .where('id', '=', body.credentialId)
        .executeTakeFirst();
      if (!credential) throw new UnprocessableError('Credencial não encontrada');
      if (!credential.type.startsWith('mcp')) {
        throw new UnprocessableError(
          'A credencial do servidor deve ser do tipo MCP (Bearer, cabeçalhos ou OAuth)',
        );
      }
      if (body.projectId && credential.project_id !== body.projectId) {
        throw new UnprocessableError('A credencial deve ser do mesmo projeto do servidor');
      }
    }
  }

  async list(projectId?: string): Promise<McpServer[]> {
    const rows = await this.db
      .selectFrom('mcp_servers')
      .selectAll()
      .$if(projectId !== undefined, (q) =>
        q.where((eb) =>
          eb.or([eb('project_id', 'is', null), eb('project_id', '=', projectId ?? '')]),
        ),
      )
      .orderBy('name')
      .execute();
    return rows.map(toServer);
  }

  async get(id: string): Promise<McpServer> {
    return toServer(await this.load(id));
  }

  /** FR-001: o servidor entra pendente; só é usado depois de aprovado. */
  async create(ctx: AuditContext, body: McpServerBody): Promise<McpServer> {
    await this.checkReferences(body);
    const row = await this.db
      .transaction()
      .execute(async (trx) => {
        const saved = await trx
          .insertInto('mcp_servers')
          .values({
            name: body.name,
            description: body.description ?? '',
            transport: body.transport,
            url: body.url,
            credential_id: body.credentialId ?? null,
            project_id: body.projectId ?? null,
            created_by: ctx.userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.audit.record(trx, ctx, {
          action: 'mcp.server_create',
          entityType: 'mcp_server',
          entityId: saved.id,
          details: {
            name: saved.name,
            transport: saved.transport,
            url: saved.url,
            projectId: saved.project_id,
          },
        });
        return saved;
      })
      .catch((e: unknown) => this.conflict(e));
    return toServer(row);
  }

  /**
   * Trocar endereço, transporte, credencial ou escopo é outro servidor: volta a pendente e o
   * snapshot é descartado (nova aprovação).
   */
  async update(ctx: AuditContext, id: string, body: McpServerBody): Promise<McpServer> {
    const current = await this.load(id);
    await this.checkReferences(body);
    const reapprove =
      current.url !== body.url ||
      current.transport !== body.transport ||
      current.credential_id !== (body.credentialId ?? null) ||
      current.project_id !== (body.projectId ?? null);
    const row = await this.db
      .transaction()
      .execute(async (trx) => {
        const saved = await trx
          .updateTable('mcp_servers')
          .set({
            name: body.name,
            description: body.description ?? '',
            transport: body.transport,
            url: body.url,
            credential_id: body.credentialId ?? null,
            project_id: body.projectId ?? null,
            updated_at: new Date(),
            ...(reapprove && {
              status: 'pending' as const,
              tools_snapshot: null,
              snapshot_pending_diff: null,
              approved_by: null,
              approved_at: null,
            }),
          })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.audit.record(trx, ctx, {
          action: 'mcp.server_update',
          entityType: 'mcp_server',
          entityId: id,
          details: { name: saved.name, url: saved.url, reapprovalRequired: reapprove },
        });
        return saved;
      })
      .catch((e: unknown) => this.conflict(e));
    await this.connections.drop(id);
    return toServer(row);
  }

  async remove(ctx: AuditContext, id: string): Promise<void> {
    const current = await this.load(id);
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('mcp_servers').where('id', '=', id).execute();
      await this.audit.record(trx, ctx, {
        action: 'mcp.server_delete',
        entityType: 'mcp_server',
        entityId: id,
        details: { name: current.name },
      });
    });
    await this.connections.drop(id);
  }

  /** HU-1, cenário 1: testa a conexão e mostra capacidades e tools (sem aprovar). */
  async test(ctx: AuditContext, id: string): Promise<McpServerTestResponse> {
    const server = await this.load(id);
    let response: McpServerTestResponse;
    try {
      const credential = await this.connections.serverCredential(server);
      response = await this.connections.once(server, credential, async (connection) => ({
        ok: true,
        serverInfo: connection.serverInfo,
        tools: await connection.listTools(),
      }));
      await this.db
        .updateTable('mcp_servers')
        .set({ server_info: JSON.stringify(response.serverInfo) })
        .where('id', '=', id)
        .execute();
    } catch (error) {
      response = { ok: false, message: message(error) };
    }
    await this.audit.record(this.db, ctx, {
      action: 'mcp.server_test',
      entityType: 'mcp_server',
      entityId: id,
      details: { name: server.name, ok: response.ok },
    });
    return response;
  }

  /** FR-003: aprovar grava o snapshot das tools anunciadas (base da detecção de mudanças). */
  async approve(ctx: AuditContext, id: string): Promise<McpServer> {
    const server = await this.load(id);
    const credential = await this.connections.serverCredential(server);
    const { info, tools } = await this.connections
      .once(server, credential, async (connection) => ({
        info: connection.serverInfo,
        tools: await connection.listTools(),
      }))
      .catch((error: unknown) => {
        throw new UnprocessableError(`Não foi possível conectar para aprovar: ${message(error)}`);
      });
    const row = await this.db.transaction().execute(async (trx) => {
      const saved = await trx
        .updateTable('mcp_servers')
        .set({
          status: 'active',
          tools_snapshot: JSON.stringify(snapshotTools(tools)),
          snapshot_pending_diff: null,
          server_info: JSON.stringify(info),
          approved_by: ctx.userId,
          approved_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, ctx, {
        action: 'mcp.server_approve',
        entityType: 'mcp_server',
        entityId: id,
        details: { name: saved.name, tools: tools.map((t) => t.name) },
      });
      return saved;
    });
    await this.connections.drop(id);
    return toServer(row);
  }

  async disable(ctx: AuditContext, id: string): Promise<McpServer> {
    await this.load(id);
    const row = await this.db.transaction().execute(async (trx) => {
      const saved = await trx
        .updateTable('mcp_servers')
        .set({ status: 'disabled', updated_at: new Date() })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, ctx, {
        action: 'mcp.server_disable',
        entityType: 'mcp_server',
        entityId: id,
        details: { name: saved.name },
      });
      return saved;
    });
    await this.connections.drop(id);
    return toServer(row);
  }

  /** Tools do snapshot (e as novas, pendentes) com a política efetiva no escopo (FR-002). */
  async tools(id: string, projectId: string | null): Promise<McpToolView[]> {
    const server = await this.load(id);
    const snapshot = (server.tools_snapshot ?? {}) as McpToolsSnapshot;
    const pending = server.snapshot_pending_diff as McpSnapshotDiff | null;
    const blocked = blockedTools(pending);
    const policies = await effectivePolicies(this.db, id, projectId);
    const view = (name: string, def: Omit<McpToolDefinition, 'name'>, changed: boolean) => {
      const policy = policies.get(name);
      return {
        name,
        ...(def.description !== undefined && { description: def.description }),
        inputSchema: def.inputSchema,
        policy: policy ?? { allowed: false, destructive: false, source: 'default' as const },
        changed,
      };
    };
    const tools: McpToolView[] = Object.entries(snapshot).map(([name, def]) =>
      view(name, def, blocked.has(name)),
    );
    for (const change of pending?.changes ?? []) {
      if (change.kind === 'added' && change.after)
        tools.push(view(change.name, change.after, true));
    }
    return tools.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** FR-002: libera ou nega tools do snapshot, globalmente ou para um projeto. */
  async setPolicies(ctx: AuditContext, id: string, body: McpPoliciesBody): Promise<McpToolView[]> {
    const server = await this.load(id);
    const projectId = body.projectId ?? null;
    if (server.project_id && projectId && projectId !== server.project_id) {
      throw new UnprocessableError('Este servidor é de outro projeto');
    }
    if (projectId) {
      const project = await this.db
        .selectFrom('projects')
        .select('id')
        .where('id', '=', projectId)
        .executeTakeFirst();
      if (!project) throw new UnprocessableError('Projeto não encontrado');
    }
    const snapshot = (server.tools_snapshot ?? {}) as McpToolsSnapshot;
    const unknown = body.policies.filter((p) => p.allowed && !(p.toolName in snapshot));
    if (unknown.length > 0) {
      throw new UnprocessableError(
        `Tools fora do snapshot aprovado (aprove o servidor ou aceite a mudança antes): ${unknown
          .map((p) => p.toolName)
          .join(', ')}`,
      );
    }
    await this.db.transaction().execute(async (trx) => {
      for (const policy of body.policies) {
        await trx
          .insertInto('mcp_tool_policies')
          .values({
            server_id: id,
            project_id: projectId,
            tool_name: policy.toolName,
            allowed: policy.allowed,
            destructive: policy.destructive,
            updated_by: ctx.userId,
          })
          .onConflict((oc) =>
            oc.columns(['server_id', 'project_id', 'tool_name']).doUpdateSet({
              allowed: policy.allowed,
              destructive: policy.destructive,
              updated_by: ctx.userId,
              updated_at: new Date(),
            }),
          )
          .execute();
      }
      await this.audit.record(trx, ctx, {
        action: 'mcp.policy_update',
        entityType: 'mcp_server',
        entityId: id,
        details: { server: server.name, projectId, policies: body.policies },
      });
    });
    return this.tools(id, projectId);
  }

  /** FR-003: aceita a mudança revisada; o snapshot passa a ser o que o servidor anuncia. */
  async acceptSnapshot(ctx: AuditContext, id: string): Promise<McpServer> {
    const server = await this.load(id);
    const pending = server.snapshot_pending_diff as McpSnapshotDiff | null;
    if (!pending) throw new ConflictError('Não há mudança pendente de revisão');
    const tools = new Map<string, McpToolDefinition>(
      Object.entries((server.tools_snapshot ?? {}) as McpToolsSnapshot).map(([name, t]) => [
        name,
        {
          name,
          ...(t.description !== undefined && { description: t.description }),
          inputSchema: t.inputSchema,
        },
      ]),
    );
    for (const change of pending.changes) {
      if (change.kind === 'removed') tools.delete(change.name);
      else if (change.after) tools.set(change.name, { name: change.name, ...change.after });
    }
    const row = await this.db.transaction().execute(async (trx) => {
      const saved = await trx
        .updateTable('mcp_servers')
        .set({
          tools_snapshot: JSON.stringify(snapshotTools([...tools.values()])),
          snapshot_pending_diff: null,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, ctx, {
        action: 'mcp.snapshot_accept',
        entityType: 'mcp_server',
        entityId: id,
        details: {
          server: server.name,
          changes: pending.changes.map((c) => ({ name: c.name, kind: c.kind })),
        },
      });
      return saved;
    });
    // A próxima conexão compara de novo com o snapshot aceito.
    await this.connections.drop(id);
    return toServer(row);
  }

  /** Servidores ativos no projeto com as tools liberadas e sem mudança pendente (FR-009). */
  async available(projectId: string): Promise<McpServerOption[]> {
    const rows = await this.db
      .selectFrom('mcp_servers')
      .selectAll()
      .where('status', '=', 'active')
      .where((eb) => eb.or([eb('project_id', 'is', null), eb('project_id', '=', projectId)]))
      .orderBy('name')
      .execute();
    return Promise.all(
      rows.map(async (row) => {
        const snapshot = (row.tools_snapshot ?? {}) as McpToolsSnapshot;
        const blocked = blockedTools(row.snapshot_pending_diff as McpSnapshotDiff | null);
        const policies = await effectivePolicies(this.db, row.id, projectId);
        const tools = Object.entries(snapshot)
          .filter(([name]) => policies.get(name)?.allowed === true && !blocked.has(name))
          .map(([name, t]) => ({
            name,
            ...(t.description !== undefined && { description: t.description }),
            inputSchema: t.inputSchema,
          }));
        return {
          id: row.id,
          name: row.name,
          description: row.description,
          transport: row.transport,
          tools,
        };
      }),
    );
  }

  /** FR-011: chamadas MCP da execução; argumentos só com `execution:readData`. */
  async calls(executionId: string, canReadData: boolean): Promise<McpCall[]> {
    const rows = await this.db
      .selectFrom('mcp_calls')
      .selectAll()
      .where('execution_id', '=', executionId)
      .orderBy('created_at')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      executionId: r.execution_id,
      nodeId: r.node_id,
      runIndex: r.run_index,
      itemIndex: r.item_index,
      serverId: r.server_id,
      serverName: r.server_name,
      operation: r.operation as McpOperation,
      target: r.target,
      ...(canReadData && { arguments: r.arguments }),
      status: r.status,
      durationMs: r.duration_ms,
      resultBytes: r.result_bytes,
      error: r.error,
      createdAt: r.created_at.toISOString(),
    }));
  }
}

export { toolHash };
