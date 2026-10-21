import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Db } from '@olly/db';
import type { HttpGuard } from '@olly/nodes';
import {
  OLLY_CHAT_CLIENT,
  ollyChatReplyText,
  STREAM_RESPONSE_HEADERS,
  type OllyChatMessage,
  type OllyChatPayload,
  type OllyChatSession,
  type StreamEvent,
} from '@olly/shared-types';
import type { ReadableStream } from 'node:stream/web';
import type { FastifyReply } from 'fastify';
import { sql } from 'kysely';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ConflictError, NotFoundError } from '../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';
import { HTTP_GUARD } from '../node-types/node-types.module.js';
import { OllyChatConfigService } from './olly-chat-config.service.js';

/** Margem do teto além do tempo máximo do workflow (como o stream da spec 027). */
const GRACE_MS = 30_000;
/** Corpo guardado de uma resposta que não é streaming (limite de memória). */
const MAX_BODY_CHARS = 5 * 1024 * 1024;
const TITLE_PREVIEW = 40;

const isStreamEvent = (value: unknown): value is StreamEvent =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { type?: unknown }).type === 'string' &&
  typeof (value as { metadata?: unknown }).metadata === 'object';

/** Resultado da chamada ao webhook: a resposta (texto exibido) ou o erro. */
type Outcome =
  { ok: true; text: string; executionId: string | null } | { ok: false; message: string };
type WebhookResponse = Awaited<ReturnType<HttpGuard['fetch']>>;

/**
 * Chat da plataforma (spec 028, plan §3–§4): sessões do usuário e envio das mensagens ao
 * webhook configurado. A API monta o payload com o usuário da sessão de login (FR-004), chama o
 * webhook pelo filtro de rede e repassa o stream (spec 027) ao navegador, guardando a pergunta e
 * a resposta, mesmo que o navegador feche no meio.
 */
@Injectable()
export class OllyChatService {
  private readonly logger = new Logger('OllyChat');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(HTTP_GUARD) private readonly guard: HttpGuard,
    @Inject(OllyChatConfigService) private readonly settings: OllyChatConfigService,
  ) {}

  /** Teto de uma resposta; `pending` mais antiga que isso foi interrompida (plan §4). */
  private maxResponseMs(): number {
    return this.config.execution.workflowTimeoutMs + GRACE_MS;
  }

  private staleBefore(): Date {
    return new Date(Date.now() - this.maxResponseMs());
  }

  async status(): Promise<{ configured: boolean }> {
    return { configured: (await this.settings.target()) !== null };
  }

  async list(user: AuthenticatedUser): Promise<OllyChatSession[]> {
    const rows = await this.db
      .selectFrom('olly_chat_sessions as s')
      .select([
        's.id',
        's.number',
        's.title',
        's.created_at',
        's.last_message_at',
        (eb) =>
          eb
            .exists(
              eb
                .selectFrom('olly_chat_messages as m')
                .select('m.id')
                .whereRef('m.session_id', '=', 's.id')
                .where('m.status', '=', 'pending')
                .where('m.created_at', '>', this.staleBefore()),
            )
            .as('busy'),
      ])
      .where('s.user_id', '=', user.id)
      .orderBy('s.last_message_at', 'desc')
      .orderBy('s.number', 'desc')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      createdAt: r.created_at.toISOString(),
      lastMessageAt: r.last_message_at.toISOString(),
      busy: Boolean(r.busy),
    }));
  }

  /** Nova sessão: o contador do usuário garante que o número nunca é reaproveitado (FR-003). */
  async create(user: AuthenticatedUser): Promise<OllyChatSession> {
    const row = await this.db.transaction().execute(async (trx) => {
      const { chat_sessions_created: number } = await trx
        .updateTable('users')
        .set({ chat_sessions_created: sql<number>`chat_sessions_created + 1` })
        .where('id', '=', user.id)
        .returning('chat_sessions_created')
        .executeTakeFirstOrThrow();
      return trx
        .insertInto('olly_chat_sessions')
        .values({ user_id: user.id, number, title: `Sessão ${String(number)}` })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    return {
      id: row.id,
      number: row.number,
      title: row.title,
      createdAt: row.created_at.toISOString(),
      lastMessageAt: row.last_message_at.toISOString(),
      busy: false,
    };
  }

  /** Sessão do usuário; de outro usuário ou inexistente: 404. */
  private async owned(user: AuthenticatedUser, sessionId: string) {
    const row = await this.db
      .selectFrom('olly_chat_sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    if (!row) throw new NotFoundError('Sessão não encontrada');
    return row;
  }

  async rename(user: AuthenticatedUser, sessionId: string, title: string): Promise<void> {
    await this.owned(user, sessionId);
    await this.db
      .updateTable('olly_chat_sessions')
      .set({ title: title.trim(), title_custom: true })
      .where('id', '=', sessionId)
      .execute();
  }

  async remove(user: AuthenticatedUser, sessionId: string): Promise<void> {
    await this.owned(user, sessionId);
    await this.db.deleteFrom('olly_chat_sessions').where('id', '=', sessionId).execute();
  }

  async messages(user: AuthenticatedUser, sessionId: string): Promise<OllyChatMessage[]> {
    await this.owned(user, sessionId);
    const rows = await this.db
      .selectFrom('olly_chat_messages')
      .selectAll()
      .where('session_id', '=', sessionId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    const stale = this.staleBefore();
    return rows.map((r) => {
      // A API caiu no meio da resposta: aparece como interrompida (plan §4).
      const interrupted = r.status === 'pending' && r.created_at <= stale;
      return {
        id: r.id,
        role: interrupted ? 'error' : r.role,
        text: interrupted ? 'Resposta interrompida: envie a mensagem de novo' : r.text,
        createdAt: r.created_at.toISOString(),
        pending: r.status === 'pending' && !interrupted,
        executionId: r.execution_id,
      };
    });
  }

  /**
   * Envia a mensagem (FR-004 a FR-007, FR-010): grava a pergunta e a resposta pendente (uma por
   * vez na sessão), assume a resposta HTTP e repassa o stream do webhook até o fim.
   */
  async send(
    reply: FastifyReply,
    user: AuthenticatedUser,
    sessionId: string,
    message: string,
  ): Promise<void> {
    const session = await this.owned(user, sessionId);
    const target = await this.settings.target();
    if (!target) throw new ConflictError('O chat ainda não foi configurado pela administração');
    const pendingId = await this.db.transaction().execute(async (trx) => {
      // Bloqueia a sessão: duas mensagens ao mesmo tempo não passam juntas pela checagem.
      await trx
        .selectFrom('olly_chat_sessions')
        .select('id')
        .where('id', '=', session.id)
        .forUpdate()
        .executeTakeFirst();
      const busy = await trx
        .selectFrom('olly_chat_messages')
        .select('id')
        .where('session_id', '=', session.id)
        .where('status', '=', 'pending')
        .where('created_at', '>', this.staleBefore())
        .executeTakeFirst();
      if (busy) throw new ConflictError('A sessão ainda está respondendo a mensagem anterior');
      // Pendentes antigas (interrompidas) viram erro.
      await trx
        .updateTable('olly_chat_messages')
        .set({
          role: 'error',
          text: 'Resposta interrompida: envie a mensagem de novo',
          status: 'done',
        })
        .where('session_id', '=', session.id)
        .where('status', '=', 'pending')
        .execute();
      const first = !(await trx
        .selectFrom('olly_chat_messages')
        .select('id')
        .where('session_id', '=', session.id)
        .executeTakeFirst());
      const now = new Date();
      await trx
        .insertInto('olly_chat_messages')
        .values({ session_id: session.id, role: 'user', text: message, created_at: now })
        .execute();
      const pending = await trx
        .insertInto('olly_chat_messages')
        .values({
          session_id: session.id,
          role: 'assistant',
          text: '',
          status: 'pending',
          // Depois da pergunta, na ordem.
          created_at: new Date(now.getTime() + 1),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const preview = message.replace(/\s+/g, ' ').trim().slice(0, TITLE_PREVIEW);
      await trx
        .updateTable('olly_chat_sessions')
        .set({
          last_message_at: now,
          ...(first &&
            !session.title_custom && {
              title: `Sessão ${String(session.number)} · ${preview}`,
            }),
        })
        .where('id', '=', session.id)
        .execute();
      return pending.id;
    });

    const person = await this.db
      .selectFrom('users')
      .select(['email', 'name', 'idp_username'])
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    const payload: OllyChatPayload = {
      chatSessionId: String(session.number),
      client: OLLY_CHAT_CLIENT,
      email: person.email,
      login: person.idp_username ?? person.email,
      name: person.name ?? '',
      message,
    };

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { ...STREAM_RESPONSE_HEADERS });
    raw.flushHeaders();
    // O navegador pode fechar no meio: a resposta continua sendo lida e guardada.
    const conn = { open: true };
    raw.on('close', () => {
      conn.open = false;
    });
    const write = (line: string) => {
      if (conn.open && !raw.writableEnded) raw.write(line.endsWith('\n') ? line : `${line}\n`);
    };

    const outcome = await this.callWebhook(target.webhookUrl, target.headers, payload, write);
    await this.db
      .updateTable('olly_chat_messages')
      .set(
        outcome.ok
          ? {
              role: 'assistant',
              text: outcome.text,
              status: 'done',
              execution_id: outcome.executionId,
            }
          : { role: 'error', text: outcome.message, status: 'done' },
      )
      .where('id', '=', pendingId)
      .execute();
    await this.db
      .updateTable('olly_chat_sessions')
      .set({ last_message_at: new Date() })
      .where('id', '=', session.id)
      .execute();
    if (conn.open && !raw.writableEnded) raw.end();
  }

  /**
   * Chama o webhook e repassa o stream ao navegador (`write`). Resposta comum (JSON ou texto) e
   * erros viram um `item` ou um `error` no mesmo formato (spec 027).
   */
  private async callWebhook(
    url: string,
    headers: Record<string, string>,
    payload: OllyChatPayload,
    write: (line: string) => void,
  ): Promise<Outcome> {
    const timestamp = () => Date.now();
    const fail = (message: string): Outcome => {
      write(
        JSON.stringify({
          type: 'error',
          content: message,
          metadata: { executionId: '', timestamp: timestamp() },
        }),
      );
      return { ok: false, message };
    };
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.maxResponseMs());
    try {
      let res: WebhookResponse;
      try {
        res = await this.guard.fetch(url, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) return fail('O assistente não respondeu a tempo');
        const cause = (error as { cause?: unknown }).cause;
        const reason = cause instanceof Error ? cause : error;
        this.logger.warn(`Olly Chat: webhook indisponível: ${String(reason)}`);
        return fail(
          reason instanceof Error && reason.name === 'SsrfBlockedError'
            ? `${reason.message}. Peça à administração para liberar o endereço no filtro de rede`
            : 'O assistente está indisponível no momento',
        );
      }
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 2000);
        let message = `O assistente recusou a mensagem (HTTP ${String(res.status)})`;
        try {
          const parsed = JSON.parse(body) as { message?: unknown };
          if (typeof parsed.message === 'string') message = `${message}: ${parsed.message}`;
        } catch {
          // Corpo que não é JSON: fica a mensagem genérica.
        }
        return fail(message);
      }
      return await this.readResponse(res, write, fail);
    } catch (error) {
      if (controller.signal.aborted) return fail('O assistente não respondeu a tempo');
      this.logger.warn(`Olly Chat: resposta interrompida: ${String(error)}`);
      return fail('A resposta do assistente foi interrompida');
    } finally {
      clearTimeout(timer);
    }
  }

  private async readResponse(
    res: WebhookResponse,
    write: (line: string) => void,
    fail: (message: string) => Outcome,
  ): Promise<Outcome> {
    const state: { streamed: boolean; final: Outcome | null; executionId: string | null } = {
      streamed: false,
      final: null,
      executionId: null,
    };
    let text = '';
    let buffer = '';
    const handle = (line: string) => {
      if (!line.trim()) return;
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (!isStreamEvent(event)) return;
      state.streamed = true;
      write(line);
      const id = (event.metadata as { executionId?: unknown }).executionId;
      if (typeof id === 'string' && id) state.executionId = id;
      if (event.type === 'item') {
        state.final = {
          ok: true,
          text: ollyChatReplyText(event.content),
          executionId: state.executionId,
        };
      }
      if (event.type === 'error') state.final = { ok: false, message: event.content };
    };
    if (res.body) {
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (text.length < MAX_BODY_CHARS) text += chunk;
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) handle(line);
      }
    }
    handle(buffer);
    if (state.streamed) return state.final ?? fail('O assistente encerrou sem resposta');
    // Resposta comum (de uma vez): JSON ou texto vira o `item` final.
    let content: unknown = text;
    try {
      content = JSON.parse(text) as unknown;
    } catch {
      // Texto puro.
    }
    write(
      JSON.stringify({
        type: 'item',
        content,
        metadata: { executionId: '', timestamp: Date.now(), final: true },
      }),
    );
    return { ok: true, text: ollyChatReplyText(content), executionId: null };
  }
}
