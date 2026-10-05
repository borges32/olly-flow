import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { Authenticator, type Authentication } from '../auth/authenticator.js';
import { AbilityFactory, canInProject } from '../rbac/ability.factory.js';
import { ResourceResolver } from '../rbac/resource-resolver.js';
import {
  ExecutionEventsService,
  dataRoom,
  executionRoom,
  workflowRoom,
} from './execution-events.service.js';
import { joinSchema, joinWorkflowSchema } from './executions.schemas.js';

export type JoinAck = { ok: true } | { ok: false; error: 'invalid' | 'not_found' };

/**
 * Namespace `/executions` (plan §7): o token é validado no handshake e cada `join` verifica
 * `execution:read` no projeto da execução (FR-013). Sem permissão, responde como inexistente.
 */
@WebSocketGateway({ namespace: 'executions' })
export class ExecutionsGateway implements OnGatewayInit {
  private readonly logger = new Logger(ExecutionsGateway.name);
  /** Autenticação feita no handshake, por conexão. */
  private readonly sessions = new WeakMap<Socket, Authentication>();

  constructor(
    @Inject(Authenticator) private readonly authenticator: Authenticator,
    @Inject(AbilityFactory) private readonly abilities: AbilityFactory,
    @Inject(ResourceResolver) private readonly resources: ResourceResolver,
    @Inject(ExecutionEventsService) private readonly events: ExecutionEventsService,
  ) {}

  afterInit(namespace: Namespace): void {
    this.events.attach(namespace);
    namespace.use((socket, next) => {
      const token = (socket.handshake.auth as { token?: unknown }).token;
      this.authenticator
        .authenticate(typeof token === 'string' ? token : undefined)
        .then((auth) => {
          this.sessions.set(socket, auth);
          next();
        })
        .catch((error: unknown) => {
          this.logger.debug(`Conexão WebSocket recusada: ${String(error)}`);
          next(new Error('unauthenticated'));
        });
    });
  }

  @SubscribeMessage('join')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<JoinAck> {
    const parsed = joinSchema.safeParse(body);
    const auth = this.sessions.get(socket);
    if (!parsed.success || !auth) return { ok: false, error: 'invalid' };
    const { executionId } = parsed.data;
    const access = await this.access(auth, 'execution', executionId);
    if (!access.read) return { ok: false, error: 'not_found' };
    const room = executionRoom(executionId);
    await socket.join(access.readData ? dataRoom(room) : room);
    return { ok: true };
  }

  /**
   * Entra na sala do workflow para receber os eventos de todas as execuções dele desde o
   * início, sem depender de conhecer o id antes (evita perder eventos de execuções rápidas).
   */
  @SubscribeMessage('joinWorkflow')
  async joinWorkflow(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<JoinAck> {
    const parsed = joinWorkflowSchema.safeParse(body);
    const auth = this.sessions.get(socket);
    if (!parsed.success || !auth) return { ok: false, error: 'invalid' };
    const { workflowId } = parsed.data;
    const access = await this.access(auth, 'workflow', workflowId);
    if (!access.read) return { ok: false, error: 'not_found' };
    const room = workflowRoom(workflowId);
    // Spec 005, FR-014: sem `execution:readData`, a sala recebe os eventos sem dados.
    await socket.join(access.readData ? dataRoom(room) : room);
    return { ok: true };
  }

  @SubscribeMessage('leaveWorkflow')
  async leaveWorkflow(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<{ ok: boolean }> {
    const parsed = joinWorkflowSchema.safeParse(body);
    if (parsed.success) {
      const room = workflowRoom(parsed.data.workflowId);
      await socket.leave(room);
      await socket.leave(dataRoom(room));
    }
    return { ok: parsed.success };
  }

  /** `execution:read` e `execution:readData` no projeto, com permissões recalculadas a cada pedido. */
  private async access(
    auth: Authentication,
    kind: 'workflow' | 'execution',
    id: string,
  ): Promise<{ read: boolean; readData: boolean }> {
    const projectId = await this.resources.projectIdFor(kind, id);
    if (!projectId) return { read: false, readData: false };
    const user = await this.authenticator.toUser(auth.account, auth.claims);
    const ability = this.abilities.forUser(user);
    return {
      read: canInProject(ability, 'execution:read', projectId),
      readData: canInProject(ability, 'execution:readData', projectId),
    };
  }

  @SubscribeMessage('leave')
  async leave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<{ ok: boolean }> {
    const parsed = joinSchema.safeParse(body);
    if (parsed.success) {
      const room = executionRoom(parsed.data.executionId);
      await socket.leave(room);
      await socket.leave(dataRoom(room));
    }
    return { ok: parsed.success };
  }
}
