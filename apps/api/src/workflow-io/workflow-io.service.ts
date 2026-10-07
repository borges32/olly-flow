import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@olly/db';
import { validateWorkflow } from '@olly/engine';
import type { NodeRegistry } from '@olly/nodes';
import {
  checkUntrusted,
  fromWorkflowFile,
  resolveCredentialRef,
  toWorkflowFile,
  type ImportIssue,
  type ImportPreview,
  type ImportTarget,
  type MigrationReport,
  type NodeTypeCatalog,
  type WorkflowDefinition,
  type WorkflowDetail,
  type WorkflowFile,
} from '@olly/shared-types';
import { AiGatewayFactory } from '../ai/ai-gateway.service.js';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  PayloadTooLargeError,
  PermissionDeniedError,
  UnprocessableError,
} from '../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';
import { CredentialsService } from '../credentials/credentials.service.js';
import { NODE_REGISTRY } from '../node-types/node-types.module.js';
import { hasProjectPermission } from '../rbac/ability.factory.js';
import { methodOf, pathOf, webhookNodes } from '../webhooks/publishing.service.js';
import { WorkflowsService } from '../workflows/workflows.service.js';
import { convertN8n } from './n8n/convert.js';
import type { ExportBody, ImportBody } from './workflow-io.schemas.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObjectWithNodes = (v: unknown): v is { nodes: unknown[] } =>
  v !== null && typeof v === 'object' && Array.isArray((v as { nodes?: unknown }).nodes);
const isObjectWithId = (v: unknown): v is { id: string } =>
  v !== null && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string';
const isLiteral = (v: unknown): v is string =>
  typeof v === 'string' && v !== '' && !v.startsWith('=');

interface BuiltImport {
  preview: ImportPreview;
  definition: WorkflowDefinition;
}

/**
 * Baixar e importar workflows em JSON (spec 015): formato do Olly Flow (estrutura do N8N) e
 * importação de arquivos do N8N. A conversão é a de `@olly/shared-types` (a mesma do editor).
 */
@Injectable()
export class WorkflowIoService {
  private readonly catalog: NodeTypeCatalog;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NODE_REGISTRY) private readonly registry: NodeRegistry,
    @Inject(CredentialsService) private readonly credentials: CredentialsService,
    @Inject(WorkflowsService) private readonly workflows: WorkflowsService,
    @Inject(AiGatewayFactory) private readonly ai: AiGatewayFactory,
  ) {
    this.catalog = { get: (type) => this.registry.get(type) };
  }

  // ---------------------------------------------------------------------------------------
  // Exportação (HU-1)
  // ---------------------------------------------------------------------------------------

  /** FR-006: rascunho salvo. */
  async exportSaved(
    ctx: AuditContext,
    workflowId: string,
  ): Promise<{ file: WorkflowFile; filename: string }> {
    const wf = await this.workflows.get(workflowId);
    return this.export(ctx, wf, wf.definition, wf.name, 'saved');
  }

  /** FR-006: o que está no canvas (inclusive alterações não salvas). */
  async exportCanvas(
    ctx: AuditContext,
    workflowId: string,
    body: ExportBody,
  ): Promise<{ file: WorkflowFile; filename: string }> {
    const wf = await this.workflows.get(workflowId);
    return this.export(ctx, wf, body.definition, body.name ?? wf.name, 'canvas');
  }

  private async export(
    ctx: AuditContext,
    wf: WorkflowDetail,
    definition: WorkflowDefinition,
    name: string,
    source: 'saved' | 'canvas',
  ): Promise<{ file: WorkflowFile; filename: string }> {
    const credentials = new Map((await this.credentials.list(wf.projectId)).map((c) => [c.id, c]));
    const file = toWorkflowFile(this.withoutSecretParams(definition), {
      catalog: this.catalog,
      name,
      credentialOf: (id) => {
        const c = credentials.get(id);
        return c && { type: c.type, name: c.name };
      },
      workflowId: wf.id,
      ...(source === 'saved' && { workflowVersion: wf.version }),
      exportedAt: new Date().toISOString(),
    });
    // FR-008: auditoria sem o conteúdo.
    await this.audit.record(this.db, ctx, {
      action: 'workflow.export',
      entityType: 'workflow',
      entityId: wf.id,
      details: { projectId: wf.projectId, source, nodes: definition.nodes.length },
    });
    return { file, filename: `${name}.json` };
  }

  /** FR-007: parâmetros marcados como sensíveis (`x-secret`) não saem no arquivo. */
  private withoutSecretParams(def: WorkflowDefinition): WorkflowDefinition {
    return {
      ...def,
      nodes: def.nodes.map((n) => {
        const props = (this.registry.get(n.type)?.paramsSchema.properties ?? {}) as Record<
          string,
          { 'x-secret'?: boolean }
        >;
        const secret = Object.keys(props).filter((k) => props[k]?.['x-secret'] === true);
        if (secret.length === 0) return n;
        return {
          ...n,
          params: Object.fromEntries(Object.entries(n.params).filter(([k]) => !secret.includes(k))),
        };
      }),
    };
  }

  // ---------------------------------------------------------------------------------------
  // Importação (HU-2 e HU-3)
  // ---------------------------------------------------------------------------------------

  async preview(
    user: AuthenticatedUser,
    projectId: string,
    body: ImportBody,
  ): Promise<ImportPreview> {
    return (await this.build(user, projectId, body)).preview;
  }

  /**
   * FR-010/FR-017/FR-028: sobrepõe o rascunho do workflow correspondente (nova versão) ou cria
   * um novo; nunca publica. Audita sem o conteúdo.
   */
  async import(
    ctx: AuditContext,
    user: AuthenticatedUser,
    projectId: string,
    body: ImportBody,
  ): Promise<{ workflow: WorkflowDetail; preview: ImportPreview; overwritten: boolean }> {
    const { preview, definition } = await this.build(user, projectId, body);
    if (preview.errors.length > 0) {
      throw new UnprocessableError('O arquivo não pode ser importado', {
        issues: preview.errors.map((e) => ({ code: e.code, message: e.message })),
      });
    }
    const target = preview.target;
    let workflow: WorkflowDetail;
    if (target) {
      if (!hasProjectPermission(user, 'workflow:update', projectId)) {
        throw new PermissionDeniedError(
          `Sobrepor o workflow "${target.name}" exige a permissão workflow:update`,
        );
      }
      workflow = await this.workflows.save(ctx, user, target.workflowId, {
        definition,
        baseVersion: target.version,
        message: 'Importado de arquivo JSON',
        ...(body.name && { name: body.name }),
      });
    } else {
      workflow = await this.workflows.create(ctx, user, projectId, {
        name: preview.name,
        definition,
      });
    }
    await this.audit.record(this.db, ctx, {
      action: 'workflow.import',
      entityType: 'workflow',
      entityId: workflow.id,
      details: {
        projectId,
        format: preview.format,
        overwritten: target !== undefined,
        nodes: preview.counts.nodes,
        pending: preview.pending.length,
        unsupported: definition.nodes.filter((n) => n.type === 'placeholder.unsupported').length,
      },
    });
    return { workflow, preview, overwritten: target !== undefined };
  }

  /**
   * FR-028: o workflow do projeto que o arquivo representa: pelo `id` do arquivo (baixado do
   * Olly Flow); senão, pelo nome dado (no arquivo ou na tela), se for único no projeto.
   */
  private async findTarget(
    projectId: string,
    fileId: string | undefined,
    name: string | undefined,
    warnings: ImportIssue[],
  ): Promise<ImportTarget | undefined> {
    const base = this.db
      .selectFrom('workflows')
      .select(['id', 'name', 'version', 'published_version'])
      .where('project_id', '=', projectId)
      .where('deleted_at', 'is', null);
    const toTarget = (
      row: { id: string; name: string; version: number; published_version: number | null },
      matchedBy: ImportTarget['matchedBy'],
    ): ImportTarget => ({
      workflowId: row.id,
      name: row.name,
      version: row.version,
      published: row.published_version !== null,
      matchedBy,
    });
    if (fileId && UUID.test(fileId)) {
      const row = await base.where('id', '=', fileId).executeTakeFirst();
      if (row) return toTarget(row, 'id');
    }
    if (!name) return undefined;
    const rows = await base.where('name', '=', name).limit(2).execute();
    if (rows.length === 1 && rows[0]) return toTarget(rows[0], 'name');
    if (rows.length > 1) {
      warnings.push({
        code: 'IMPORT_NAME_AMBIGUOUS',
        message: `Há mais de um workflow chamado "${name}" neste projeto: um novo será criado. Para sobrepor um deles, importe o arquivo baixado dele.`,
      });
    }
    return undefined;
  }

  private parseContent(content: unknown): { value?: unknown; error?: ImportIssue } {
    const { maxBytes } = this.config.workflowImport;
    const size =
      typeof content === 'string'
        ? Buffer.byteLength(content, 'utf8')
        : Buffer.byteLength(JSON.stringify(content), 'utf8');
    if (size > maxBytes) {
      throw new PayloadTooLargeError(
        `O arquivo tem ${String(size)} bytes; o limite é ${String(maxBytes)} bytes (OLLY_IMPORT_MAX_BYTES)`,
      );
    }
    if (typeof content !== 'string') return { value: content };
    try {
      return { value: JSON.parse(content) as unknown };
    } catch (error) {
      return {
        error: {
          code: 'IMPORT_INVALID_JSON',
          message: `O conteúdo não é um JSON válido: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  }

  private async build(
    user: AuthenticatedUser,
    projectId: string,
    body: ImportBody,
  ): Promise<BuiltImport> {
    const issues = {
      errors: [] as ImportIssue[],
      pending: [] as ImportIssue[],
      warnings: [] as ImportIssue[],
    };
    let migration: MigrationReport | undefined;
    const fail = (): BuiltImport => ({
      preview: {
        name: body.name ?? 'Workflow importado',
        format: body.format,
        counts: { nodes: 0, connections: 0 },
        ...issues,
        ...(migration && { migration }),
      },
      definition: { nodes: [], edges: [], settings: {} },
    });
    const parsed = this.parseContent(body.content);
    if (parsed.error) {
      issues.errors.push(parsed.error);
      return fail();
    }
    let input = parsed.value;
    if (body.format === 'n8n') {
      // FR-018 antes da conversão: o arquivo do N8N também é conteúdo não confiável.
      const { maxDepth, maxNodes } = this.config.workflowImport;
      const hostile = checkUntrusted(input, maxDepth);
      const count = isObjectWithNodes(input) ? input.nodes.length : 0;
      if (hostile) issues.errors.push(hostile);
      else if (count > maxNodes) {
        issues.errors.push({
          code: 'IMPORT_TOO_MANY_NODES',
          message: `O arquivo tem ${String(count)} nós; o limite é ${String(maxNodes)}`,
        });
      }
      if (issues.errors.length > 0) return fail();
      const converted = convertN8n(input);
      migration = converted.report;
      if (converted.errors.length > 0) {
        issues.errors.push(...converted.errors);
        return fail();
      }
      input = converted.file;
    }
    const result = fromWorkflowFile(input, {
      catalog: this.catalog,
      newId: randomUUID,
      limits: {
        maxNodes: this.config.workflowImport.maxNodes,
        maxDepth: this.config.workflowImport.maxDepth,
      },
      allowN8nTypes: body.format === 'n8n',
    });
    issues.errors.push(...result.issues.errors);
    issues.pending.push(...result.issues.pending);
    issues.warnings.push(...result.issues.warnings);
    const definition = result.definition;
    const names = new Map(definition.nodes.map((n) => [n.id, n.name]));
    if (issues.errors.length === 0) {
      // FR-012: as mesmas regras do salvamento.
      const validation = validateWorkflow(definition, this.registry);
      const node = (ids: string[]) => {
        const first = ids[0] ? names.get(ids[0]) : undefined;
        return first ? { node: first } : {};
      };
      issues.errors.push(
        ...validation.errors.map((e) => ({ code: e.code, message: e.message, ...node(e.nodeIds) })),
      );
      issues.warnings.push(
        ...validation.warnings.map((e) => ({
          code: e.code,
          message: e.message,
          ...node(e.nodeIds),
        })),
      );
    }
    if (issues.errors.length === 0) {
      await this.resolveCredentials(
        user,
        projectId,
        definition,
        result.credentialRefs,
        issues.pending,
      );
      await this.checkReferences(projectId, definition, issues.pending);
    }
    const given = (body.name ?? result.name).slice(0, 200);
    let target: ImportTarget | undefined;
    if (issues.errors.length === 0) {
      const fileId =
        body.format === 'olly' && isObjectWithId(parsed.value) ? parsed.value.id : undefined;
      target = await this.findTarget(projectId, fileId, given || undefined, issues.warnings);
      if (target?.published) {
        issues.warnings.push({
          code: 'IMPORT_TARGET_PUBLISHED',
          message: `O workflow "${target.name}" está publicado: a importação muda só o rascunho; a produção continua na versão publicada até publicar de novo`,
        });
      }
    }
    return {
      preview: {
        name: target && !body.name ? target.name : given || 'Workflow importado',
        format: body.format,
        counts: result.counts,
        ...issues,
        ...(migration && { migration }),
        ...(target && { target }),
      },
      definition,
    };
  }

  /** FR-014/FR-025: liga às credenciais do projeto; nunca cria. Sem `credential:use`, nenhuma. */
  private async resolveCredentials(
    user: AuthenticatedUser,
    projectId: string,
    definition: WorkflowDefinition,
    refs: ReturnType<typeof fromWorkflowFile>['credentialRefs'],
    pending: ImportIssue[],
  ): Promise<void> {
    if (refs.length === 0) return;
    const canUse = hasProjectPermission(user, 'credential:use', projectId);
    const available = canUse
      ? (await this.credentials.list(projectId)).map((c) => ({
          id: c.id,
          type: c.type,
          name: c.name,
        }))
      : [];
    const byId = new Map(definition.nodes.map((n) => [n.id, n]));
    for (const ref of refs) {
      const node = byId.get(ref.nodeId);
      if (!node) continue;
      const accepted = this.registry.get(node.type)?.credentialTypes ?? [];
      const found = resolveCredentialRef(ref, available, accepted);
      if (found) {
        node.credentialId = found.id;
        continue;
      }
      pending.push({
        code: 'CREDENTIAL_PENDING',
        message: `Nó "${node.name}": escolha a credencial ${ref.type}${ref.name ? ` ("${ref.name}")` : ''}${canUse ? '' : ' (sem permissão para usar credenciais neste projeto)'}`,
        node: node.name,
      });
    }
  }

  /** FR-015: referências a recursos que não existem ou não estão acessíveis no destino. */
  private async checkReferences(
    projectId: string,
    definition: WorkflowDefinition,
    pending: ImportIssue[],
  ): Promise<void> {
    const params = (type: string[], key: string) =>
      definition.nodes
        .filter((n) => type.includes(n.type))
        .map((n) => ({ node: n, value: n.params[key] }));

    // Workflows chamados (sub-workflow e ferramenta de workflow).
    const calls = params(['flow.executeWorkflow', 'tool.workflow'], 'workflowId');
    const errorWorkflow = definition.settings.errorWorkflowId;
    const ids = [...calls.map((c) => c.value), errorWorkflow].filter(
      (v): v is string => typeof v === 'string' && UUID.test(v),
    );
    const found =
      ids.length === 0
        ? []
        : await this.db
            .selectFrom('workflows as w')
            .innerJoin('workflow_versions as v', (join) =>
              join.onRef('v.workflow_id', '=', 'w.id').onRef('v.version', '=', 'w.version'),
            )
            .select(['w.id', 'v.definition'])
            .where('w.id', 'in', ids)
            .where('w.project_id', '=', projectId)
            .where('w.deleted_at', 'is', null)
            .execute();
    const existing = new Map(found.map((r) => [r.id, r.definition as WorkflowDefinition]));
    for (const { node, value } of calls) {
      if (typeof value === 'string' && value.startsWith('=')) continue;
      if (typeof value !== 'string' || !existing.has(value)) {
        pending.push({
          code: 'WORKFLOW_REF_NOT_FOUND',
          message: `Nó "${node.name}": o workflow chamado não existe neste projeto; escolha-o de novo`,
          node: node.name,
        });
      }
    }
    if (errorWorkflow) {
      const target = existing.get(errorWorkflow);
      if (!target?.nodes.some((n) => n.type === 'trigger.error')) {
        delete definition.settings.errorWorkflowId;
        pending.push({
          code: 'ERROR_WORKFLOW_REMOVED',
          message:
            'O workflow de erro não existe neste projeto (ou não começa por "Gatilho de erro") e foi retirado das configurações',
        });
      }
    }

    // Servidores MCP (catálogo do projeto).
    const servers = params(['ai.mcpClient', 'tool.mcp'], 'serverId');
    const serverIds = servers
      .map((s) => s.value)
      .filter((v): v is string => typeof v === 'string' && UUID.test(v));
    const activeServers =
      serverIds.length === 0
        ? new Set<string>()
        : new Set(
            (
              await this.db
                .selectFrom('mcp_servers')
                .select('id')
                .where('id', 'in', serverIds)
                .where('status', '=', 'active')
                .where((eb) =>
                  eb.or([eb('project_id', 'is', null), eb('project_id', '=', projectId)]),
                )
                .execute()
            ).map((r) => r.id),
          );
    for (const { node, value } of servers) {
      if (typeof value === 'string' && activeServers.has(value)) continue;
      pending.push({
        code: 'MCP_SERVER_NOT_FOUND',
        message: `Nó "${node.name}": escolha o servidor MCP do catálogo deste projeto`,
        node: node.name,
      });
    }

    // Modelos de IA liberados no projeto.
    const models = params(['ai.chatModel'], 'model').filter((m) => isLiteral(m.value));
    if (models.length > 0) {
      const allowed = new Set(await this.ai.allowedModels(projectId));
      for (const { node, value } of models) {
        if (allowed.has(value as string)) continue;
        pending.push({
          code: 'AI_MODEL_NOT_ALLOWED',
          message: `Nó "${node.name}": o modelo "${String(value)}" não está liberado neste projeto (Administração › IA)`,
          node: node.name,
        });
      }
    }

    // Caminhos de webhook já publicados por outro workflow.
    const hooks = webhookNodes(definition).map((n) => ({
      node: n,
      method: methodOf(n),
      path: pathOf(n),
    }));
    if (hooks.length > 0) {
      const used = await this.db
        .selectFrom('webhooks')
        .select(['method', 'path'])
        .where((eb) =>
          eb.or(hooks.map((h) => eb.and([eb('method', '=', h.method), eb('path', '=', h.path)]))),
        )
        .execute();
      for (const h of hooks) {
        if (!used.some((u) => u.method === h.method && u.path === h.path)) continue;
        pending.push({
          code: 'WEBHOOK_PATH_IN_USE',
          message: `Nó "${h.node.name}": ${h.method} /webhook/${h.path} já é usado por outro workflow publicado; a publicação vai acusar o conflito`,
          node: h.node.name,
        });
      }
    }
  }
}
