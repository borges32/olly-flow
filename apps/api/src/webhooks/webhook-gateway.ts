import { ollyMetrics } from '@olly/telemetry';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ipInList, verifyWebhookAuth, type WebhookResponse } from '@olly/nodes';
import type { Item, WorkflowNode } from '@olly/shared-types';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BINARY_STORAGE } from '../binary/binary.module.js';
import type { S3BinaryStorage } from '../binary/s3-binary-store.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { CredentialsService } from '../credentials/credentials.service.js';
import { ExecutionDispatcher } from '../executions/dispatcher.js';
import { ExecutionEventsService } from '../executions/execution-events.service.js';
import type { ExecutionOutcome } from '../executions/execution-job.js';
import { ExecutionsService } from '../executions/executions.service.js';
import { normalizePath } from './paths.js';
import { FixedWindowLimiter } from './rate-limiter.js';
import { TestListeners } from './test-listeners.js';
import { WebhookRegistry } from './webhook-registry.js';

/** Cabeçalhos que nunca vão para o item (credenciais do chamador). */
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'proxy-authorization', 'x-signature'];

interface Resolved {
  node: WorkflowNode;
  params: Record<string, string>;
  projectId: string;
  workflowId: string;
  rateKey: string;
  /** Teste parado no Webhook: responde na hora, sem esperar os nós seguintes (HU-2.1). */
  stopAtNode: boolean;
  launch(item: Item): Promise<{ executionId: string }>;
}

/** O texto como objeto ou lista JSON, se for um; senão `undefined` (texto comum continua texto). */
function jsonObjectOrList(text: string): unknown {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return undefined;
  try {
    const value = JSON.parse(trimmed) as unknown;
    return value !== null && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const list = (v: unknown) =>
  str(v)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Gateway de webhooks (spec 005, FR-004 a FR-007, plan §3): `/webhook/<path>` (publicados) e
 * `/webhook-test/<path>` (escuta do editor), fora do prefixo `/api/v1` e dos guards da API, com
 * autenticação própria por credencial.
 */
@Injectable()
export class WebhookGateway {
  private readonly logger = new Logger('Webhooks');
  private readonly limiter = new FixedWindowLimiter();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(WebhookRegistry) private readonly registry: WebhookRegistry,
    @Inject(TestListeners) private readonly listeners: TestListeners,
    @Inject(ExecutionsService) private readonly executions: ExecutionsService,
    @Inject(ExecutionDispatcher) private readonly dispatcher: ExecutionDispatcher,
    @Inject(ExecutionEventsService) private readonly events: ExecutionEventsService,
    @Inject(CredentialsService) private readonly credentials: CredentialsService,
    @Inject(BINARY_STORAGE) private readonly binaries: S3BinaryStorage | null,
  ) {}

  /** Registra as rotas num escopo do Fastify que recebe o corpo cru (HMAC sobre os bytes). */
  register(fastify: FastifyInstance): void {
    void fastify.register((scope, _opts, done) => {
      scope.removeAllContentTypeParsers();
      scope.addContentTypeParser(
        '*',
        { parseAs: 'buffer', bodyLimit: this.config.webhook.maxBodyBytes },
        (_req, body, next) => {
          next(null, body);
        },
      );
      // Spec 012, FR-002: requisições recebidas pelos webhooks, por status de resposta.
      scope.addHook('onResponse', (_req, reply, hookDone) => {
        ollyMetrics.webhookRequest(reply.statusCode);
        hookDone();
      });
      const route = (test: boolean) => (req: FastifyRequest, reply: FastifyReply) =>
        this.handle(req, reply, test);
      scope.all('/webhook/*', { bodyLimit: this.config.webhook.maxBodyBytes }, route(false));
      scope.all('/webhook-test/*', { bodyLimit: this.config.webhook.maxBodyBytes }, route(true));
      done();
    });
  }

  private async resolve(method: string, path: string, test: boolean): Promise<Resolved | null> {
    if (test) {
      const found =
        method === 'OPTIONS' ? this.listeners.anyMethod(path) : this.listeners.match(method, path);
      if (!found) return null;
      const l = found.route;
      return {
        node: l.node,
        params: found.params,
        projectId: l.projectId,
        workflowId: l.workflowId,
        rateKey: `test:${l.workflowId}:${l.node.id}`,
        stopAtNode: l.stopAtNode,
        launch: async (item) => {
          this.listeners.consume(l.workflowId);
          const run = await this.executions.startTestRun(
            l.audit,
            l.user,
            l.workflowId,
            {
              definition: l.definition,
              ...(l.stopAtNode && { destinationNodeId: l.node.id }),
            },
            {
              type: 'webhook',
              triggerItems: [item],
              startNodeId: l.node.id,
            },
          );
          this.events.emit(
            'testWebhookReceived',
            {
              executionId: run.executionId,
              workflowId: l.workflowId,
              nodeId: l.node.id,
              payload: item,
            },
            l.workflowId,
          );
          return run;
        },
      };
    }
    const found =
      method === 'OPTIONS'
        ? await this.registry.anyMethod(path)
        : await this.registry.match(method, path);
    if (!found) return null;
    const r = found.route;
    return {
      node: r.node,
      params: found.params,
      projectId: r.workflow.project_id,
      workflowId: r.workflow.id,
      rateKey: `prod:${r.key}`,
      stopAtNode: false,
      launch: (item) =>
        this.executions.launch({
          workflow: r.workflow,
          version: r.workflow.version,
          definition: r.definition,
          mode: 'production',
          triggerType: 'webhook',
          triggeredBy: null,
          job: { triggerItems: [item], startNodeId: r.node.id },
        }),
    };
  }

  private async handle(req: FastifyRequest, reply: FastifyReply, test: boolean): Promise<void> {
    const method = req.method.toUpperCase();
    const path = normalizePath((req.params as { '*'?: string })['*'] ?? '');
    const resolved = await this.resolve(method, path, test);
    if (!resolved) {
      await reply.code(404).send({
        message: test
          ? 'Webhook de teste não encontrado: clique em "Escutar chamada de teste" no editor'
          : 'Webhook não encontrado',
      });
      return;
    }
    const options = (resolved.node.params.options ?? {}) as Record<string, unknown>;

    // CORS (FR-006).
    const origin = str(req.headers.origin);
    const origins = list(options.allowedOrigins);
    if (origin && (origins.includes('*') || origins.includes(origin))) {
      void reply
        .header('access-control-allow-origin', origins.includes('*') ? '*' : origin)
        .header('vary', 'Origin');
    }
    if (method === 'OPTIONS') {
      await reply
        .code(204)
        .header('access-control-allow-methods', str(resolved.node.params.httpMethod) || 'POST')
        .header(
          'access-control-allow-headers',
          str(req.headers['access-control-request-headers']) || '*',
        )
        .send();
      return;
    }

    // Allowlist de IP (FR-006).
    const ips = list(options.ipAllowlist);
    if (ips.length > 0 && !ipInList(req.ip, ips)) {
      await reply.code(403).send({ message: 'IP não permitido para este webhook' });
      return;
    }

    // Rate limit por rota (FR-006).
    if (!this.limiter.hit(resolved.rateKey, this.config.webhook.rateLimitPerMin)) {
      await reply
        .code(429)
        .header('retry-after', '60')
        .send({ message: 'Limite de chamadas do webhook excedido' });
      return;
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const hidden = new Set(SENSITIVE_HEADERS);
    const auth = str(resolved.node.params.authentication) || 'none';
    if (auth !== 'none') {
      const ok = await this.authenticate(resolved, req, rawBody, hidden);
      if (!ok) {
        await reply.code(401).send({ message: 'Autenticação do webhook inválida' });
        return;
      }
    }

    let item: Item;
    try {
      item = await this.buildItem(req, rawBody, resolved.params, hidden);
    } catch (error) {
      await reply
        .code(400)
        .send({ message: error instanceof Error ? error.message : 'Corpo inválido' });
      return;
    }

    let executionId: string;
    try {
      ({ executionId } = await resolved.launch(item));
    } catch (error) {
      this.logger.warn(
        `Webhook ${method} ${path}: não foi possível iniciar a execução: ${String(error)}`,
      );
      await reply.code(500).send({ message: 'Não foi possível iniciar a execução' });
      return;
    }
    if (resolved.stopAtNode) {
      await reply
        .code(202)
        .send({ executionId, message: 'Chamada de teste recebida pelo nó Webhook' });
      return;
    }
    await this.respond(reply, resolved.node, executionId);
  }

  private async authenticate(
    resolved: Resolved,
    req: FastifyRequest,
    rawBody: Buffer,
    hidden: Set<string>,
  ): Promise<boolean> {
    try {
      const { credential } = await this.credentials.resolveForExecution(
        resolved.projectId,
        resolved.node.credentialId,
      );
      if (credential.type === 'webhookHeaderAuth')
        hidden.add(str(credential.data.name).toLowerCase());
      if (credential.type === 'webhookHmac')
        hidden.add((str(credential.data.headerName) || 'x-signature').toLowerCase());
      return verifyWebhookAuth(credential.type, credential.data, { headers: req.headers, rawBody });
    } catch (error) {
      this.logger.warn(
        `Credencial do webhook indisponível (workflow ${resolved.workflowId}): ${String(error)}`,
      );
      return false;
    }
  }

  /** Item do gatilho: `{ headers, params, query, body }` (FR-004), sem cabeçalhos sensíveis. */
  private async buildItem(
    req: FastifyRequest,
    rawBody: Buffer,
    params: Record<string, string>,
    hidden: Set<string>,
  ): Promise<Item> {
    const headers = Object.fromEntries(
      Object.entries(req.headers).filter(([name]) => !hidden.has(name.toLowerCase())),
    );
    const contentType = str(req.headers['content-type']).toLowerCase();
    const json: Record<string, unknown> = { headers, params, query: req.query ?? {}, body: {} };
    if (rawBody.length === 0) return { json };
    if (contentType.includes('json')) {
      try {
        json.body = JSON.parse(rawBody.toString('utf8')) as unknown;
      } catch {
        throw new Error('Corpo JSON inválido');
      }
      return { json };
    }
    const isForm = contentType.includes('application/x-www-form-urlencoded');
    // Clientes que enviam JSON sem declarar (`fetch` sem cabeçalho: text/plain; `curl -d`:
    // formulário; ou sem Content-Type): um objeto ou lista JSON válido vira objeto.
    if (isForm || contentType.startsWith('text/plain') || contentType === '') {
      const parsed = jsonObjectOrList(rawBody.toString('utf8'));
      if (parsed !== undefined) {
        json.body = parsed;
        return { json };
      }
    }
    if (isForm) {
      json.body = Object.fromEntries(new URLSearchParams(rawBody.toString('utf8')));
      return { json };
    }
    if (contentType.startsWith('text/') || contentType.includes('xml') || !this.binaries) {
      json.body = rawBody.toString('utf8');
      return { json };
    }
    // Outros tipos: o conteúdo vai para o object storage (FR-010 da spec 004).
    const mimeType = contentType.split(';')[0]?.trim() || 'application/octet-stream';
    const ref = await this.binaries.put(`webhooks/${randomUUID()}`, new Uint8Array(rawBody), {
      mimeType,
    });
    return { json, binary: { data: ref } };
  }

  /** Modos de resposta (FR-005): imediata, último nó ou nó de resposta, com 504 no timeout. */
  private async respond(
    reply: FastifyReply,
    node: WorkflowNode,
    executionId: string,
  ): Promise<void> {
    const mode = str(node.params.responseMode) || 'onReceived';
    if (mode === 'onReceived') {
      await reply.code(202).send({ executionId });
      return;
    }
    const timeoutMs = this.config.webhook.responseTimeoutMs;
    const result = await this.dispatcher.waitForResult(
      executionId,
      timeoutMs,
      mode === 'responseNode',
    );
    if (result.kind === 'timeout') {
      await reply.code(504).send({
        message: 'A execução não respondeu a tempo; ela continua em andamento',
        executionId,
      });
      return;
    }
    if (result.kind === 'response') {
      await this.sendResponse(reply, result.response, executionId);
      return;
    }
    await this.sendOutcome(reply, result.outcome, mode, executionId);
  }

  private async sendOutcome(
    reply: FastifyReply,
    outcome: ExecutionOutcome,
    mode: string,
    executionId: string,
  ): Promise<void> {
    if (outcome.status !== 'success') {
      await reply.code(500).send({
        message:
          outcome.status === 'cancelled'
            ? 'A execução foi interrompida antes do fim'
            : 'O workflow terminou com erro',
        executionId,
        error: outcome.error?.message,
      });
      return;
    }
    if (mode === 'responseNode') {
      await reply.code(500).send({
        message: 'O workflow terminou sem executar o nó "Responder ao webhook"',
        executionId,
      });
      return;
    }
    await reply.code(200).send(outcome.lastOutput?.[0]?.json ?? {});
  }

  /** Resposta do nó "Responder ao webhook" (FR-008). */
  private async sendResponse(
    reply: FastifyReply,
    response: WebhookResponse,
    executionId: string,
  ): Promise<void> {
    void reply.code(response.statusCode);
    for (const [name, value] of Object.entries(response.headers)) void reply.header(name, value);
    const body = response.body;
    if (!body) {
      await reply.send();
      return;
    }
    if (body.kind === 'json') {
      if (!reply.hasHeader('content-type'))
        void reply.header('content-type', 'application/json; charset=utf-8');
      await reply.send(JSON.stringify(body.value ?? null));
      return;
    }
    if (body.kind === 'text') {
      if (!reply.hasHeader('content-type'))
        void reply.header('content-type', 'text/plain; charset=utf-8');
      await reply.send(body.value);
      return;
    }
    if (!this.binaries) {
      await reply
        .code(500)
        .send({ message: 'Armazenamento de binários não configurado', executionId });
      return;
    }
    const data = await this.binaries.get(body.ref);
    if (!reply.hasHeader('content-type')) void reply.header('content-type', body.ref.mimeType);
    await reply.send(Buffer.from(data));
  }
}
