import { Inject, Injectable } from '@nestjs/common';
import type { Db, McpServerRow } from '@olly/db';
import type { Masker } from '@olly/engine';
import { blockedTools, toolHash, type McpConnection } from '@olly/mcp-client';
import type { McpCallRef, McpGateway, McpToolCallResult } from '@olly/nodes';
import type {
  McpOperation,
  McpSnapshotDiff,
  McpToolDefinition,
  McpToolsSnapshot,
} from '@olly/shared-types';
import { AuditService } from '../audit/audit.service.js';
import { DB } from '../core/tokens.js';
import { McpConnections } from './mcp-connections.service.js';

/** FR-012: tool sem liberação no projeto (negada por padrão, FR-002). */
export class McpToolNotAllowedError extends Error {
  override name = 'McpToolNotAllowedError';
}

/** FR-003: tool liberada que mudou desde a aprovação; bloqueada até a revisão. */
export class McpToolChangedError extends Error {
  override name = 'McpToolChangedError';
}

export class McpServerUnavailableError extends Error {
  override name = 'McpServerUnavailableError';
}

export interface McpExecutionContext {
  executionId: string;
  projectId: string;
  /** Mascaramento do projeto (spec 009): argumentos e erros gravados em `mcp_calls`. */
  masker: Masker;
}

interface Recorded {
  operation: McpOperation;
  target?: string;
  arguments?: unknown;
}

/** Política efetiva: a do projeto prevalece sobre a global; sem registro, negado (FR-002). */
export async function effectivePolicies(
  db: Db,
  serverId: string,
  projectId: string | null,
): Promise<Map<string, { allowed: boolean; destructive: boolean; source: 'project' | 'global' }>> {
  const rows = await db
    .selectFrom('mcp_tool_policies')
    .select(['tool_name', 'allowed', 'destructive', 'project_id'])
    .where('server_id', '=', serverId)
    .where((eb) =>
      projectId
        ? eb.or([eb('project_id', 'is', null), eb('project_id', '=', projectId)])
        : eb('project_id', 'is', null),
    )
    .execute();
  const policies = new Map<
    string,
    { allowed: boolean; destructive: boolean; source: 'project' | 'global' }
  >();
  for (const row of rows.sort((a, b) => (a.project_id ? 1 : 0) - (b.project_id ? 1 : 0))) {
    policies.set(row.tool_name, {
      allowed: row.allowed,
      destructive: row.destructive,
      source: row.project_id ? 'project' : 'global',
    });
  }
  return policies;
}

/**
 * Acesso governado aos servidores MCP nas execuções (spec 010, plan §5–§6). Entregue ao motor
 * como `RunOptions.mcp`; vale para a API (execução em processo) e para os workers.
 */
@Injectable()
export class McpGatewayFactory {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(McpConnections) private readonly connections: McpConnections,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  forExecution(ctx: McpExecutionContext): McpGateway {
    const servers = new Map<string, Promise<McpServerRow>>();
    const loadServer = (serverId: string) => {
      let server = servers.get(serverId);
      if (!server) {
        server = this.loadServer(serverId, ctx.projectId);
        servers.set(serverId, server);
        void server.catch(() => servers.delete(serverId));
      }
      return server;
    };

    const record = async (
      ref: McpCallRef,
      server: McpServerRow,
      call: Recorded,
      outcome: {
        status: 'success' | 'error' | 'denied' | 'blocked';
        startedAt: number;
        result?: unknown;
        error?: unknown;
      },
    ) => {
      const error =
        outcome.error === undefined ? null : ctx.masker.maskText(errorMessage(outcome.error));
      await this.db
        .insertInto('mcp_calls')
        .values({
          execution_id: ctx.executionId,
          project_id: ctx.projectId,
          node_id: ref.nodeId,
          run_index: ref.runIndex,
          item_index: ref.itemIndex,
          server_id: server.id,
          server_name: server.name,
          operation: call.operation,
          target: call.target ?? null,
          // VIII.2/SC-007: só os argumentos mascarados são gravados.
          arguments:
            call.arguments === undefined
              ? null
              : JSON.stringify(ctx.masker.mask(call.arguments).value),
          status: outcome.status,
          duration_ms: Math.max(0, Math.round(performance.now() - outcome.startedAt)),
          result_bytes:
            outcome.result === undefined ? null : Buffer.byteLength(JSON.stringify(outcome.result)),
          error,
        })
        .execute();
    };

    /** Executa a operação com a conexão do servidor, registrando sucesso ou erro (FR-011). */
    const run = async <T>(
      ref: McpCallRef,
      call: Recorded,
      fn: (connection: McpConnection, server: McpServerRow) => Promise<T>,
      /** Falha no nível da tool (`isError`): a chamada funcionou, mas é registrada como erro. */
      toolError?: (result: T) => string | undefined,
    ): Promise<T> => {
      const server = await loadServer(ref.serverId);
      const startedAt = performance.now();
      try {
        const credential = ref.credential ?? (await this.connections.serverCredential(server));
        const result = await this.connections.use(server, credential, (c) => fn(c, server));
        const failure = toolError?.(result);
        await record(ref, server, call, {
          status: failure === undefined ? 'success' : 'error',
          startedAt,
          result,
          ...(failure !== undefined && { error: failure }),
        });
        return result;
      } catch (error) {
        if (!(error instanceof McpToolNotAllowedError || error instanceof McpToolChangedError)) {
          await record(ref, server, call, { status: 'error', startedAt, error });
        }
        throw error;
      }
    };

    /** Política e snapshot de uma tool (FR-002, FR-003); negação registrada e auditada (FR-012). */
    const checkTool = async (
      ref: McpCallRef,
      server: McpServerRow,
      toolName: string,
      args: unknown,
      connection: McpConnection,
    ): Promise<McpToolDefinition> => {
      const startedAt = performance.now();
      const call: Recorded = { operation: 'callTool', target: toolName, arguments: args };
      const policy = (await effectivePolicies(this.db, server.id, ctx.projectId)).get(toolName);
      const snapshot = (server.tools_snapshot ?? {}) as McpToolsSnapshot;
      const approved = snapshot[toolName];
      if (!policy?.allowed || !approved) {
        const error = new McpToolNotAllowedError(
          `Tool "${toolName}" do servidor MCP "${server.name}" não está liberada para este projeto`,
        );
        await record(ref, server, call, { status: 'denied', startedAt, error });
        await this.auditDenied(ctx, ref, server, toolName, 'mcp.tool_denied');
        throw error;
      }
      const live = (await connection.tools({ ...(ref.signal && { signal: ref.signal }) })).find(
        (t) => t.name === toolName,
      );
      const pending = server.snapshot_pending_diff as McpSnapshotDiff | null;
      if (!live || toolHash(live) !== approved.hash || blockedTools(pending).has(toolName)) {
        const error = new McpToolChangedError(
          `A tool "${toolName}" do servidor MCP "${server.name}" mudou desde a aprovação; as chamadas estão bloqueadas até a revisão no catálogo MCP`,
        );
        await record(ref, server, call, { status: 'blocked', startedAt, error });
        await this.auditDenied(ctx, ref, server, toolName, 'mcp.tool_blocked');
        throw error;
      }
      return {
        name: toolName,
        ...(approved.description !== undefined && { description: approved.description }),
        inputSchema: approved.inputSchema,
      };
    };

    const signalOf = (ref: McpCallRef) => (ref.signal ? { signal: ref.signal } : {});

    return {
      prepareTool: async (ref) => {
        const server = await loadServer(ref.serverId);
        const credential = ref.credential ?? (await this.connections.serverCredential(server));
        return this.connections.use(server, credential, (c) =>
          checkTool(ref, server, ref.toolName, undefined, c),
        );
      },
      callTool: (ref) =>
        run(
          ref,
          { operation: 'callTool', target: ref.toolName, arguments: ref.arguments },
          async (connection, server) => {
            // A verificação se repete na chamada: o servidor pode mudar entre preparar e chamar.
            await checkTool(ref, server, ref.toolName, ref.arguments, connection);
            return connection.callTool(ref.toolName, ref.arguments, signalOf(ref));
          },
          (result) => (result.isError ? toolErrorText(result) : undefined),
        ),
      listTools: (ref) =>
        run(ref, { operation: 'listTools' }, async (connection, server) => {
          // Só o que o projeto pode usar: liberado e sem mudança pendente.
          const policies = await effectivePolicies(this.db, server.id, ctx.projectId);
          const snapshot = (server.tools_snapshot ?? {}) as McpToolsSnapshot;
          const blocked = blockedTools(server.snapshot_pending_diff as McpSnapshotDiff | null);
          return (await connection.tools(signalOf(ref))).filter(
            (t) =>
              policies.get(t.name)?.allowed === true &&
              snapshot[t.name]?.hash === toolHash(t) &&
              !blocked.has(t.name),
          );
        }),
      listResources: (ref) =>
        run(
          ref,
          { operation: 'listResources' },
          async (c) =>
            (await c.listResources(signalOf(ref))) as unknown as Record<string, unknown>[],
        ),
      readResource: (ref) =>
        run(ref, { operation: 'readResource', target: ref.uri }, async (c) => {
          const result = await c.readResource(ref.uri, signalOf(ref));
          return { contents: result.contents as unknown as Record<string, unknown>[] };
        }),
      listPrompts: (ref) =>
        run(
          ref,
          { operation: 'listPrompts' },
          async (c) => (await c.listPrompts(signalOf(ref))) as unknown as Record<string, unknown>[],
        ),
      getPrompt: (ref) =>
        run(
          ref,
          { operation: 'getPrompt', target: ref.name, arguments: ref.arguments },
          async (c) => {
            const result = await c.getPrompt(ref.name, ref.arguments, signalOf(ref));
            return {
              ...(result.description !== undefined && { description: result.description }),
              messages: result.messages as unknown as Record<string, unknown>[],
            };
          },
        ),
    };
  }

  private async loadServer(serverId: string, projectId: string): Promise<McpServerRow> {
    const server = await this.db
      .selectFrom('mcp_servers')
      .selectAll()
      .where('id', '=', serverId)
      .executeTakeFirst()
      .catch(() => undefined);
    if (!server || (server.project_id !== null && server.project_id !== projectId)) {
      throw new McpServerUnavailableError('Servidor MCP não encontrado neste projeto');
    }
    if (server.status !== 'active') {
      throw new McpServerUnavailableError(
        `O servidor MCP "${server.name}" não está ativo (${server.status === 'pending' ? 'aguardando aprovação' : 'desativado'})`,
      );
    }
    return server;
  }

  /** FR-012: negação auditada em nome de quem disparou a execução. */
  private async auditDenied(
    ctx: McpExecutionContext,
    ref: McpCallRef,
    server: McpServerRow,
    toolName: string,
    action: 'mcp.tool_denied' | 'mcp.tool_blocked',
  ): Promise<void> {
    const execution = await this.db
      .selectFrom('executions')
      .select('triggered_by')
      .where('id', '=', ctx.executionId)
      .limit(1)
      .executeTakeFirst();
    await this.audit.record(
      this.db,
      { userId: execution?.triggered_by ?? null, ip: null },
      {
        action,
        entityType: 'mcp_server',
        entityId: server.id,
        details: {
          projectId: ctx.projectId,
          executionId: ctx.executionId,
          nodeId: ref.nodeId,
          server: server.name,
          tool: toolName,
        },
      },
    );
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Erro desconhecido';
}

function toolErrorText(result: McpToolCallResult): string {
  const text = result.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n')
    .trim();
  return text || 'A tool devolveu erro (isError)';
}
