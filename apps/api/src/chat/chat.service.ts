import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
  Busboy,
  type BusboyFileStream,
  type BusboyHeaders,
  type BusboyInstance,
} from '@fastify/busboy';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Db } from '@olly/db';
import { RecordedRun, buildExpressionData } from '@olly/engine';
import { exposedEnv, type ExpressionEvaluator } from '@olly/expressions';
import {
  chatConfig,
  chatHistory,
  chatMessageText,
  chatResponseBody,
  chatSettings,
  fileAllowed,
  verifyWebhookAuth,
  type ChatSettings,
  type NodeRegistry,
} from '@olly/nodes';
import {
  CHAT_MEMORY_PORT,
  CHAT_TRIGGER_ORIGIN,
  CHAT_TRIGGER_TYPE,
  RESPONSE_MODE_STREAMING,
  type BinaryRef,
  type ChatTestReply,
  type ChatTestStart,
  type Item,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@olly/shared-types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { AuditContext } from '../audit/audit.service.js';
import { Authenticator } from '../auth/authenticator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { BINARY_STORAGE } from '../binary/binary.module.js';
import type { S3BinaryStorage } from '../binary/s3-binary-store.js';
import { NotFoundError, UnprocessableError } from '../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB, REDIS } from '../core/tokens.js';
import { CredentialsService } from '../credentials/credentials.service.js';
import { ExecutionDispatcher } from '../executions/dispatcher.js';
import type { WaitResult } from '../executions/execution-job.js';
import { ExecutionsService } from '../executions/executions.service.js';
import { EXPRESSION_EVALUATOR } from '../expressions/expressions.module.js';
import { NODE_REGISTRY } from '../node-types/node-types.module.js';
import { FixedWindowLimiter } from '../webhooks/rate-limiter.js';
import { StreamResponder, streamResponseContent } from '../webhooks/stream-responder.js';
import { sendWebhookResponse } from '../webhooks/webhook-response.js';

/** Workflow publicado e nó de chat de uma rota `/webhook/<webhookId>/chat`. */
export interface ChatTarget {
  key: string;
  workflow: { id: string; name: string; project_id: string; version: number; active: boolean };
  definition: WorkflowDefinition;
  node: WorkflowNode;
}

/** Mensagem recebida (FR-001), já validada. */
export interface ChatMessage {
  action: 'sendMessage' | 'loadPreviousSession';
  sessionId: string;
  chatInput: string;
  files: { fileName: string; mimeType: string; data: Buffer }[];
}

/** Erro de validação da mensagem, com o status HTTP. */
export class ChatRequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const SESSION_ID_MAX = 200;
const LOCK_RETRY_MS = 200;
const TEST_LOCK_PREFIX = 'olly:chat:test-run:';
/** Libera o lock só se ainda for nosso (outro pedido pode tê-lo ganho após a expiração). */
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;
/** Spec 027: renova a trava da sessão enquanto o stream durar (ela é da mesma mensagem). */
const EXTEND = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end return 0`;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sessão de um chat: mensagens da mesma sessão do mesmo workflow, uma de cada vez (FR-014). */
const sessionLockKey = (workflowId: string, mode: 'test' | 'production', sessionId: string) =>
  `olly:chat:${workflowId}:${mode}:${sessionId}`;

/**
 * Chat (spec 021, plan §4–§5): atende o chat publicado (`/webhook/<webhookId>/chat`, pelo
 * gateway de webhooks) e o painel do editor. Autentica, valida a mensagem e os arquivos, espera a
 * vez da sessão, lança a execução e devolve a resposta no formato do N8N.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger('Chat');
  private readonly limiter = new FixedWindowLimiter();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ExecutionsService) private readonly executions: ExecutionsService,
    @Inject(ExecutionDispatcher) private readonly dispatcher: ExecutionDispatcher,
    @Inject(CredentialsService) private readonly credentials: CredentialsService,
    @Inject(Authenticator) private readonly authenticator: Authenticator,
    @Inject(EXPRESSION_EVALUATOR) private readonly evaluator: ExpressionEvaluator,
    @Inject(NODE_REGISTRY) private readonly registry: NodeRegistry,
    @Inject(BINARY_STORAGE) private readonly binaries: S3BinaryStorage | null,
    @Inject(StreamResponder) private readonly streams: StreamResponder,
  ) {}

  /** Chat publicado (FR-003): `GET` devolve a configuração da página; `POST`, a resposta. */
  async handlePublic(
    req: FastifyRequest,
    reply: FastifyReply,
    target: ChatTarget,
    rawBody: Buffer,
  ): Promise<void> {
    const settings = chatSettings(target.node);
    if (!settings.public) {
      await reply.code(404).send({ message: 'Este chat não está disponível' });
      return;
    }
    // FR-009: limite por endereço de origem (uma página pública tem muitos usuários).
    if (!this.limiter.hit(`chat:${target.key}:${req.ip}`, this.config.webhook.rateLimitPerMin)) {
      await reply
        .code(429)
        .header('retry-after', '60')
        .send({ message: 'Muitas mensagens em pouco tempo: aguarde um minuto' });
      return;
    }
    const user = await this.authenticate(req, settings, target, rawBody);
    if (user === false) {
      // O tipo (não a credencial) diz à página o que pedir: usuário e senha ou o login.
      await reply.code(401).send({
        message: 'Autenticação do chat inválida',
        authentication: settings.authentication,
      });
      return;
    }
    if (req.method.toUpperCase() === 'GET') {
      await reply.code(200).send(chatConfig(settings));
      return;
    }

    let message: ChatMessage;
    try {
      message = await this.parseMessage(req, rawBody, settings);
    } catch (error) {
      await this.sendError(reply, error);
      return;
    }
    if (message.action === 'loadPreviousSession') {
      await reply.code(200).send(await this.history(target, settings, message.sessionId));
      return;
    }

    const lockKey = sessionLockKey(target.workflow.id, 'production', message.sessionId);
    const token = await this.acquire(lockKey);
    if (!token) {
      await reply
        .code(409)
        .send({ message: 'A conversa ainda está respondendo a mensagem anterior' });
      return;
    }
    try {
      const item = await this.buildItem(message);
      // Spec 027 (FR-005): passos e resposta em streaming, com a mesma trava da sessão.
      if (settings.options.responseMode === RESPONSE_MODE_STREAMING) {
        const keep = setInterval(() => {
          void this.redis.eval(EXTEND, 1, lockKey, token, this.lockTtlMs()).catch(() => undefined);
        }, this.config.webhook.streamPingMs);
        try {
          await this.streams.stream(
            reply,
            { projectId: target.workflow.project_id, definition: target.definition },
            (beforeDispatch) =>
              this.executions.launch({
                workflow: target.workflow,
                version: target.workflow.version,
                definition: target.definition,
                mode: 'production',
                triggerType: CHAT_TRIGGER_ORIGIN,
                triggeredBy: user?.id ?? null,
                job: { triggerItems: [item], startNodeId: target.node.id },
                beforeDispatch,
              }),
            (result) =>
              result.kind === 'response'
                ? streamResponseContent(result.response)
                : chatResponseBody(result.outcome.lastOutput),
          );
        } finally {
          clearInterval(keep);
        }
        return;
      }
      const { executionId } = await this.executions.launch({
        workflow: target.workflow,
        version: target.workflow.version,
        definition: target.definition,
        mode: 'production',
        triggerType: CHAT_TRIGGER_ORIGIN,
        triggeredBy: user?.id ?? null,
        job: { triggerItems: [item], startNodeId: target.node.id },
      });
      const result = await this.dispatcher.waitForResult(
        executionId,
        this.config.webhook.responseTimeoutMs,
        settings.options.responseMode === 'responseNode',
      );
      await this.sendResult(reply, result, settings, executionId);
    } catch (error) {
      if (error instanceof ChatRequestError) {
        await this.sendError(reply, error);
        return;
      }
      this.logger.warn(`Chat do workflow ${target.workflow.id}: ${String(error)}`);
      await reply.code(500).send({ message: 'Não foi possível responder a mensagem' });
    } finally {
      await this.release(lockKey, token);
    }
  }

  /**
   * Painel de chat do editor (FR-002, plan §5): valida, espera a vez da sessão e inicia a
   * execução de teste; a resposta vem depois, por `testReply`.
   */
  async startTest(
    audit: AuditContext,
    user: AuthenticatedUser,
    workflowId: string,
    body: {
      definition: WorkflowDefinition;
      sessionId: string;
      chatInput: string;
      pinData?: Record<string, Item[]>;
    },
  ): Promise<ChatTestStart> {
    const node = body.definition.nodes.find((n) => n.type === CHAT_TRIGGER_TYPE && !n.disabled);
    if (!node) throw new UnprocessableError('O workflow não tem um gatilho de chat habilitado');
    const settings = chatSettings(node);
    let message: ChatMessage;
    try {
      message = this.validate({ ...body, action: 'sendMessage' }, []);
    } catch (error) {
      throw new UnprocessableError(error instanceof Error ? error.message : 'Mensagem inválida');
    }
    const lockKey = sessionLockKey(workflowId, 'test', message.sessionId);
    const token = await this.acquire(lockKey);
    if (!token) {
      throw new UnprocessableError('A conversa ainda está respondendo a mensagem anterior');
    }
    try {
      const run = await this.executions.startTestRun(
        audit,
        user,
        workflowId,
        { definition: body.definition, ...(body.pinData && { pinData: body.pinData }) },
        {
          type: CHAT_TRIGGER_ORIGIN,
          triggerItems: [await this.buildItem(message)],
          startNodeId: node.id,
        },
      );
      // O lock fica com a execução até a resposta ser buscada (ou expirar).
      await this.redis.set(
        `${TEST_LOCK_PREFIX}${run.executionId}`,
        JSON.stringify({
          workflowId,
          lockKey,
          token,
          untilResponse: settings.options.responseMode === 'responseNode',
        }),
        'PX',
        this.lockTtlMs(),
      );
      return run;
    } catch (error) {
      await this.release(lockKey, token);
      throw error;
    }
  }

  /** Resposta da mensagem do painel do editor (FR-002): espera o resultado da execução. */
  async testReply(workflowId: string, executionId: string): Promise<ChatTestReply> {
    const raw = await this.redis.get(`${TEST_LOCK_PREFIX}${executionId}`);
    const meta = raw
      ? (JSON.parse(raw) as {
          workflowId: string;
          lockKey: string;
          token: string;
          untilResponse: boolean;
        })
      : null;
    if (meta && meta.workflowId !== workflowId) throw new NotFoundError('Execução não encontrada');
    const execution = await this.db
      .selectFrom('executions')
      .select('workflow_id')
      .where('id', '=', executionId)
      .executeTakeFirst();
    if (execution?.workflow_id !== workflowId) throw new NotFoundError('Execução não encontrada');
    try {
      const result = await this.dispatcher.waitForResult(
        executionId,
        this.config.webhook.responseTimeoutMs,
        meta?.untilResponse ?? false,
      );
      return testReplyOf(result);
    } finally {
      if (meta) {
        await this.release(meta.lockKey, meta.token);
        await this.redis.del(`${TEST_LOCK_PREFIX}${executionId}`);
      }
    }
  }

  /** FR-004: `none`, Basic Auth (credencial) ou usuário logado na plataforma. */
  private async authenticate(
    req: FastifyRequest,
    settings: ChatSettings,
    target: ChatTarget,
    rawBody: Buffer,
  ): Promise<AuthenticatedUser | null | false> {
    if (settings.authentication === 'none') return null;
    if (settings.authentication === 'basicAuth') {
      try {
        const { credential } = await this.credentials.resolveForExecution(
          target.workflow.project_id,
          target.node.credentialId,
        );
        return credential.type === 'webhookBasicAuth' &&
          verifyWebhookAuth(credential.type, credential.data, { headers: req.headers, rawBody })
          ? null
          : false;
      } catch (error) {
        this.logger.warn(
          `Credencial do chat indisponível (workflow ${target.workflow.id}): ${String(error)}`,
        );
        return false;
      }
    }
    const token = /^Bearer\s+(\S+)$/i.exec(str(req.headers.authorization))?.[1];
    if (!token) return false;
    try {
      const { user } = await this.authenticator.authenticate(token);
      return user.mustChangePassword ? false : user;
    } catch {
      return false;
    }
  }

  /** Mensagem em JSON ou `multipart/form-data` (campos e `files`, como o N8N). */
  private async parseMessage(
    req: FastifyRequest,
    rawBody: Buffer,
    settings: ChatSettings,
  ): Promise<ChatMessage> {
    const contentType = str(req.headers['content-type']).toLowerCase();
    if (contentType.startsWith('multipart/form-data')) {
      const { fields, files } = await parseMultipart(req.headers, rawBody);
      if (files.length > 0 && !settings.options.allowFileUploads) {
        throw new ChatRequestError(400, 'Este chat não aceita arquivos');
      }
      for (const file of files) {
        if (!fileAllowed(file.mimeType, settings.options.allowedFilesMimeTypes)) {
          throw new ChatRequestError(400, `Tipo de arquivo não permitido: ${file.mimeType}`);
        }
      }
      return this.validate(fields, files);
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8') || '{}') as unknown;
    } catch {
      throw new ChatRequestError(400, 'Corpo JSON inválido');
    }
    if (!body || typeof body !== 'object') throw new ChatRequestError(400, 'Corpo JSON inválido');
    return this.validate(body as Record<string, unknown>, []);
  }

  /** FR-009: sessão, ação e tamanho da mensagem. */
  private validate(fields: Record<string, unknown>, files: ChatMessage['files']): ChatMessage {
    const action = str(fields.action) || 'sendMessage';
    if (action !== 'sendMessage' && action !== 'loadPreviousSession') {
      throw new ChatRequestError(400, `Ação desconhecida: ${action}`);
    }
    const sessionId = str(fields.sessionId).trim();
    if (!sessionId || sessionId.length > SESSION_ID_MAX) {
      throw new ChatRequestError(
        400,
        `Informe o sessionId (até ${String(SESSION_ID_MAX)} caracteres)`,
      );
    }
    const chatInput = str(fields.chatInput);
    if (chatInput.length > this.config.chat.maxMessageChars) {
      throw new ChatRequestError(
        413,
        `Mensagem acima de ${String(this.config.chat.maxMessageChars)} caracteres`,
      );
    }
    if (action === 'sendMessage' && !chatInput.trim() && files.length === 0) {
      throw new ChatRequestError(400, 'A mensagem está vazia');
    }
    return { action, sessionId, chatInput, files };
  }

  /** Item do gatilho (FR-001): arquivos no object storage, como binários `data0`, `data1`… */
  private async buildItem(message: ChatMessage): Promise<Item> {
    const json: Record<string, unknown> = {
      sessionId: message.sessionId,
      action: 'sendMessage',
      chatInput: message.chatInput,
    };
    if (message.files.length === 0) return { json };
    if (!this.binaries) {
      throw new ChatRequestError(500, 'Armazenamento de arquivos não configurado (S3)');
    }
    const binary: Record<string, BinaryRef> = {};
    const files: Record<string, unknown>[] = [];
    for (const [index, file] of message.files.entries()) {
      const ref = await this.binaries.put(`chat/${randomUUID()}`, new Uint8Array(file.data), {
        mimeType: file.mimeType,
        fileName: file.fileName,
      });
      binary[`data${String(index)}`] = ref;
      files.push({
        fileName: file.fileName,
        mimeType: file.mimeType,
        fileSize: file.data.byteLength,
        fileExtension: extname(file.fileName).replace(/^\./, ''),
      });
    }
    json.files = files;
    return { json, binary };
  }

  /**
   * FR-006: histórico da sessão na memória ligada ao gatilho, sem executar o workflow. A chave é
   * o `sessionKey` da memória, avaliado com `$json = { sessionId, action }`.
   */
  private async history(
    target: ChatTarget,
    settings: ChatSettings,
    sessionId: string,
  ): Promise<{ data: unknown[] }> {
    if (settings.options.loadPreviousSession !== 'memory') return { data: [] };
    const edge = target.definition.edges.find(
      (e) => e.to === target.node.id && e.toPort === CHAT_MEMORY_PORT,
    );
    const memory = edge && target.definition.nodes.find((n) => n.id === edge.from);
    // A memória temporária só existe durante uma execução: não há o que carregar.
    if (!memory || memory.type !== 'memory.postgres' || memory.disabled) return { data: [] };
    const sessionKey = await this.sessionKeyOf(target, memory, sessionId);
    if (!sessionKey) return { data: [] };
    const limit = Number(memory.params.contextWindowLength) || 10;
    const rows = await this.db
      .selectFrom('agent_memory')
      .select('message')
      .where('project_id', '=', target.workflow.project_id)
      .where('session_key', '=', sessionKey)
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
    return { data: chatHistory(rows.reverse().map((r) => r.message)) };
  }

  private async sessionKeyOf(
    target: ChatTarget,
    memory: WorkflowNode,
    sessionId: string,
  ): Promise<string> {
    const raw = memory.params.sessionKey ?? '={{ $json.sessionId }}';
    if (typeof raw === 'number') return String(raw);
    if (typeof raw !== 'string') return '';
    if (!raw.startsWith('=')) return raw.trim();
    const template = raw.slice(1);
    const executionId = `chat-history:${randomUUID()}`;
    const input: Item[] = [{ json: { sessionId, action: 'loadPreviousSession' } }];
    const data = buildExpressionData(
      target.definition,
      this.registry,
      new RecordedRun([]),
      memory,
      input,
      [template],
      {
        executionId,
        mode: 'production',
        startedAt: new Date().toISOString(),
        workflow: { id: target.workflow.id, name: target.workflow.name, active: true },
        vars: {},
        env: exposedEnv(process.env),
        timezone: this.config.execution.timezone,
      },
    );
    try {
      const [result] = await this.evaluator.evaluateBatch({
        executionId,
        data,
        requests: [{ id: 'sessionKey', template, itemIndex: 0 }],
      });
      const value = result?.ok ? result.value : undefined;
      return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    } finally {
      await this.evaluator.disposeExecution(executionId).catch(() => undefined);
    }
  }

  /** FR-005: nó de resposta, último nó, erro ou tempo esgotado. */
  private async sendResult(
    reply: FastifyReply,
    result: WaitResult,
    settings: ChatSettings,
    executionId: string,
  ): Promise<void> {
    if (result.kind === 'timeout') {
      await reply.code(504).send({ message: 'O workflow não respondeu a tempo', executionId });
      return;
    }
    if (result.kind === 'response') {
      await sendWebhookResponse(reply, result.response, executionId, this.binaries);
      return;
    }
    const outcome = result.outcome;
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
    if (settings.options.responseMode === 'responseNode') {
      await reply.code(500).send({
        message: 'O workflow terminou sem executar o nó "Responder ao webhook"',
        executionId,
      });
      return;
    }
    await reply.code(200).send(chatResponseBody(outcome.lastOutput));
  }

  private async sendError(reply: FastifyReply, error: unknown): Promise<void> {
    if (error instanceof ChatRequestError) {
      await reply.code(error.statusCode).send({ message: error.message });
      return;
    }
    await reply
      .code(400)
      .send({ message: error instanceof Error ? error.message : 'Mensagem inválida' });
  }

  private lockTtlMs(): number {
    return this.config.webhook.responseTimeoutMs + 5000;
  }

  /** FR-014: espera a vez da sessão até o tempo limite da resposta; `null` se não conseguiu. */
  private async acquire(key: string): Promise<string | null> {
    const token = randomUUID();
    const deadline = Date.now() + this.config.webhook.responseTimeoutMs;
    for (;;) {
      const ok = await this.redis.set(key, token, 'PX', this.lockTtlMs(), 'NX');
      if (ok === 'OK') return token;
      if (Date.now() + LOCK_RETRY_MS > deadline) return null;
      await sleep(LOCK_RETRY_MS);
    }
  }

  private async release(key: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE, 1, key, token).catch((error: unknown) => {
      this.logger.warn(`Não foi possível liberar a sessão do chat: ${String(error)}`);
    });
  }
}

/** Resposta do painel do editor a partir do resultado da execução (FR-002). */
export function testReplyOf(result: WaitResult): ChatTestReply {
  if (result.kind === 'timeout') {
    return { status: 'timeout', message: 'O workflow não respondeu a tempo' };
  }
  if (result.kind === 'response') {
    const body = result.response.body;
    const value =
      body?.kind === 'json' || body?.kind === 'text'
        ? body.value
        : body
          ? `[arquivo ${body.ref.fileName ?? body.ref.mimeType}]`
          : '';
    return { status: 'success', message: chatMessageText(value), body: value };
  }
  const outcome = result.outcome;
  if (outcome.status !== 'success') {
    const error = outcome.error?.message ?? 'O workflow terminou com erro';
    return { status: 'error', message: error, error };
  }
  const body = chatResponseBody(outcome.lastOutput);
  return { status: 'success', message: chatMessageText(body), body };
}

/** `multipart/form-data` a partir dos bytes já recebidos pelo gateway (FR-007). */
function parseMultipart(
  headers: FastifyRequest['headers'],
  rawBody: Buffer,
): Promise<{ fields: Record<string, string>; files: ChatMessage['files'] }> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    const files: ChatMessage['files'] = [];
    let parser: BusboyInstance;
    try {
      parser = new Busboy({ headers: headers as BusboyHeaders, limits: { files: 20 } });
    } catch {
      reject(new ChatRequestError(400, 'Corpo multipart inválido'));
      return;
    }
    parser.on('field', (name: string, value: string) => {
      fields[name] = value;
    });
    parser.on(
      'file',
      (
        _field: string,
        stream: BusboyFileStream,
        fileName: string,
        _encoding: string,
        mimeType: string,
      ) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => {
          files.push({
            fileName: fileName || 'arquivo',
            mimeType: mimeType || 'application/octet-stream',
            data: Buffer.concat(chunks),
          });
        });
      },
    );
    parser.on('error', () => {
      reject(new ChatRequestError(400, 'Corpo multipart inválido'));
    });
    parser.on('finish', () => {
      resolve({ fields, files });
    });
    parser.end(rawBody);
  });
}
