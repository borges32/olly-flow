import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@olly/db';
import { validateWorkflow } from '@olly/engine';
import { WEBHOOK_AUTH_CREDENTIAL, type NodeRegistry } from '@olly/nodes';
import type {
  PublishResponse,
  WorkflowDefinition,
  WorkflowIssue,
  WorkflowNode,
} from '@olly/shared-types';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';
import { CredentialsService } from '../credentials/credentials.service.js';
import { NODE_REGISTRY } from '../node-types/node-types.module.js';
import { isValidPath, normalizePath } from './paths.js';
import { WebhookRegistry } from './webhook-registry.js';

const UNIQUE_VIOLATION = '23505';

export const webhookNodes = (definition: WorkflowDefinition): WorkflowNode[] =>
  definition.nodes.filter((n) => n.type === 'trigger.webhook' && !n.disabled);

export const methodOf = (node: WorkflowNode) =>
  typeof node.params.httpMethod === 'string' ? node.params.httpMethod : 'POST';
export const pathOf = (node: WorkflowNode) =>
  normalizePath(typeof node.params.path === 'string' ? node.params.path : '');

/**
 * Validações dos nós de webhook (FR-002, FR-004, FR-008): caminho, repetição, autenticação com
 * credencial do projeto e do tipo certo, e nó de resposta quando o modo exige.
 */
export async function webhookIssues(
  definition: WorkflowDefinition,
  projectId: string,
  credentials: CredentialsService,
  requireAuth: boolean,
): Promise<{ errors: WorkflowIssue[]; warnings: WorkflowIssue[] }> {
  const errors: WorkflowIssue[] = [];
  const warnings: WorkflowIssue[] = [];
  const seen = new Map<string, string>();
  const nodes = webhookNodes(definition);
  const types = await credentials.typesById(
    projectId,
    nodes.flatMap((n) => (n.credentialId ? [n.credentialId] : [])),
  );
  for (const node of nodes) {
    const issue = (code: string, message: string) => ({
      code,
      message: `Nó "${node.name}": ${message}`,
      nodeIds: [node.id],
    });
    const path = pathOf(node);
    if (!isValidPath(path)) {
      errors.push(
        issue('WEBHOOK_PATH_INVALID', 'informe um caminho válido (ex.: pedidos ou clientes/:id)'),
      );
      continue;
    }
    const key = `${methodOf(node)} ${path}`;
    if (seen.has(key)) errors.push(issue('WEBHOOK_PATH_DUPLICATE', `${key} repetido no workflow`));
    seen.set(key, node.id);
    const auth =
      typeof node.params.authentication === 'string' ? node.params.authentication : 'none';
    if (auth === 'none') {
      const target = requireAuth ? errors : warnings;
      target.push(issue('WEBHOOK_NO_AUTH', 'webhook de produção sem autenticação'));
    } else {
      const expected = WEBHOOK_AUTH_CREDENTIAL[auth];
      const actual = node.credentialId ? types.get(node.credentialId) : undefined;
      if (!expected || actual !== expected) {
        errors.push(
          issue(
            'WEBHOOK_CREDENTIAL_INVALID',
            `selecione uma credencial do tipo ${expected ?? auth} deste projeto`,
          ),
        );
      }
    }
    if (
      node.params.responseMode === 'responseNode' &&
      !definition.nodes.some((n) => n.type === 'http.respondToWebhook' && !n.disabled)
    ) {
      errors.push(
        issue(
          'WEBHOOK_NO_RESPONSE_NODE',
          'o modo "nó de resposta" exige um nó "Responder ao webhook"',
        ),
      );
    }
  }
  return { errors, warnings };
}

export interface PreparedPublication {
  workflowId: string;
  projectId: string;
  version: number;
  webhooks: { nodeId: string; method: string; path: string }[];
  warnings: WorkflowIssue[];
}

/** Publicação e despublicação de workflows (spec 005, FR-001, FR-002, plan §1). */
@Injectable()
export class PublishingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(NODE_REGISTRY) private readonly registry: NodeRegistry,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CredentialsService) private readonly credentials: CredentialsService,
    @Inject(WebhookRegistry) private readonly routes: WebhookRegistry,
  ) {}

  /**
   * Valida a versão para publicação (estrutura e webhooks). Usado antes de publicar e antes de
   * abrir um pedido de aprovação (spec 009), para não pedir aprovação do que não publicaria.
   */
  async prepare(workflowId: string, requested?: number): Promise<PreparedPublication> {
    const workflow = await this.db
      .selectFrom('workflows')
      .select(['id', 'version', 'project_id'])
      .where('id', '=', workflowId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!workflow) throw new NotFoundError('Workflow não encontrado');
    const version = requested ?? workflow.version;
    const row = await this.db
      .selectFrom('workflow_versions')
      .select('definition')
      .where('workflow_id', '=', workflowId)
      .where('version', '=', version)
      .executeTakeFirst();
    if (!row) throw new NotFoundError(`Versão ${version} não encontrada`);
    const definition = row.definition as WorkflowDefinition;

    const structure = validateWorkflow(definition, this.registry);
    const hooks = await webhookIssues(
      definition,
      workflow.project_id,
      this.credentials,
      this.config.webhook.requireAuth,
    );
    const errors = [...structure.errors, ...hooks.errors];
    if (errors.length > 0) {
      throw new UnprocessableError('O workflow não pode ser publicado', {
        issues: errors.map((e) => ({ code: e.code, message: e.message, nodeIds: e.nodeIds })),
      });
    }
    return {
      workflowId,
      projectId: workflow.project_id,
      version,
      webhooks: webhookNodes(definition).map((n) => ({
        nodeId: n.id,
        method: methodOf(n),
        path: pathOf(n),
      })),
      warnings: [...structure.warnings, ...hooks.warnings],
    };
  }

  /**
   * Publica (spec 005, FR-001/FR-002). Spec 009, FR-009: a mensagem é obrigatória; vira a
   * mensagem da versão quando ela não tem uma e fica na auditoria. `approval` registra o pedido
   * aprovado que originou a publicação.
   */
  async publish(
    ctx: AuditContext,
    workflowId: string,
    requested: number | undefined,
    message: string,
    approval?: { requestId: string; requestedBy: string },
  ): Promise<PublishResponse> {
    const { version, webhooks, warnings } = await this.prepare(workflowId, requested);
    await this.db
      .transaction()
      .execute(async (trx) => {
        await trx.deleteFrom('webhooks').where('workflow_id', '=', workflowId).execute();
        for (const w of webhooks) {
          await trx
            .insertInto('webhooks')
            .values({
              workflow_id: workflowId,
              node_id: w.nodeId,
              method: w.method,
              path: w.path,
              active: true,
            })
            .execute();
        }
        await trx
          .updateTable('workflows')
          .set({ published_version: version, active: true })
          .where('id', '=', workflowId)
          .execute();
        await trx
          .updateTable('workflow_versions')
          .set({ message })
          .where('workflow_id', '=', workflowId)
          .where('version', '=', version)
          .where('message', 'is', null)
          .execute();
        await this.audit.record(trx, ctx, {
          action: 'workflow.publish',
          entityType: 'workflow',
          entityId: workflowId,
          details: {
            version,
            message,
            webhooks: webhooks.map((w) => `${w.method} ${w.path}`),
            ...(approval && { approval }),
          },
        });
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
          throw new ConflictError(
            'Um caminho de webhook deste workflow já é usado por outro workflow publicado',
          );
        }
        throw error;
      });
    this.routes.reload();
    return {
      publishedVersion: version,
      active: true,
      webhooks: webhooks.map(({ method, path }) => ({ method, path })),
      warnings,
    };
  }

  /** Remove as rotas; a versão publicada fica registrada, mas inativa. */
  async unpublish(ctx: AuditContext, workflowId: string): Promise<PublishResponse> {
    const workflow = await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('webhooks').where('workflow_id', '=', workflowId).execute();
      const updated = await trx
        .updateTable('workflows')
        .set({ active: false })
        .where('id', '=', workflowId)
        .returning(['published_version'])
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, ctx, {
        action: 'workflow.unpublish',
        entityType: 'workflow',
        entityId: workflowId,
        details: { version: updated.published_version },
      });
      return updated;
    });
    this.routes.reload();
    return {
      publishedVersion: workflow.published_version,
      active: false,
      webhooks: [],
      warnings: [],
    };
  }
}
