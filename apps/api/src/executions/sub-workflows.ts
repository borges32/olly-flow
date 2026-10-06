import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Db } from '@olly/db';
import { NodeExecutionError, parseInputSchema, type SubWorkflowGateway } from '@olly/nodes';
import type { Item, WorkflowDefinition } from '@olly/shared-types';
import { sql } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';
import type { ExecutionJob, ExecutionOutcome } from './execution-job.js';

/**
 * Fila das filhas sem espera: o `QueueDispatcher`, registrado com este token nos módulos. O
 * serviço o resolve na hora de usar, sem importar a classe: a importação criaria o ciclo
 * dispatcher → runner → sub-workflows → fila → dispatcher.
 */
export const SUBWORKFLOW_QUEUE = Symbol('SUBWORKFLOW_QUEUE');
interface SubWorkflowQueue {
  dispatch(job: ExecutionJob): Promise<void>;
}

/** `trigger_type` das execuções disparadas por um sub-workflow (spec 008, FR-010). */
export const SUBWORKFLOW_TRIGGER_TYPE = 'subworkflow';
const NO_PARTITION = '23514';

/** Executa a execução filha no mesmo processo (quando o pai aguarda). */
export type InlineRunner = (job: ExecutionJob, signal?: AbortSignal) => Promise<ExecutionOutcome>;

/**
 * Sub-workflows (spec 008, FR-009 a FR-011, plan §4). O alvo precisa estar publicado e ter o
 * gatilho "Quando chamado por outro workflow"; o dono da execução (quem a disparou, ou o dono
 * do workflow pai) precisa poder executar no projeto do alvo. Profundidade limitada
 * (`OLLY_MAX_SUBWORKFLOW_DEPTH`) e recursão detectada pela cadeia de execuções pai.
 *
 * Aguardando o término, a filha roda no mesmo worker do pai (a vaga da cota é a do pai, sem
 * risco de o pai ocupar a vaga que a filha esperaria); sem aguardar, vai para a fila.
 */
@Injectable()
export class SubWorkflowService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  forExecution(parentExecutionId: string, runInline: InlineRunner): SubWorkflowGateway {
    return {
      run: (request) => this.run(parentExecutionId, request, runInline),
      describe: (workflowId) => this.describe(workflowId),
    };
  }

  /** Spec 011: nome e schema de entrada (gatilho) do workflow publicado, para a ferramenta. */
  private async describe(
    workflowId: string,
  ): Promise<{ name: string; inputSchema: Record<string, unknown> | null }> {
    const target = await this.db
      .selectFrom('workflows as w')
      .leftJoin('workflow_versions as v', (join) =>
        join.onRef('v.workflow_id', '=', 'w.id').onRef('v.version', '=', 'w.published_version'),
      )
      .select(['w.name', 'w.published_version', 'v.definition'])
      .where('w.id', '=', workflowId)
      .where('w.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!target) throw new NodeExecutionError('Workflow da ferramenta não encontrado');
    if (target.published_version === null || !target.definition) {
      throw new NodeExecutionError(`O workflow "${target.name}" não está publicado`);
    }
    const trigger = (target.definition as WorkflowDefinition).nodes.find(
      (n) => n.type === 'trigger.executeWorkflow',
    );
    if (!trigger) {
      throw new NodeExecutionError(
        `O workflow "${target.name}" não tem o gatilho "Quando chamado por outro workflow"`,
      );
    }
    return { name: target.name, inputSchema: parseInputSchema(trigger.params.inputSchema) };
  }

  private async run(
    parentExecutionId: string,
    request: { workflowId: string; items: Item[]; wait: boolean; signal?: AbortSignal },
    runInline: InlineRunner,
  ): Promise<{ executionId: string; status: string; items: Item[] }> {
    const parent = await this.db
      .selectFrom('executions as e')
      .innerJoin('workflows as w', 'w.id', 'e.workflow_id')
      .select([
        'e.workflow_id',
        'e.project_id',
        'e.triggered_by',
        'e.depth',
        'e.parent_execution_id',
        'w.created_by',
      ])
      .where('e.id', '=', parentExecutionId)
      .limit(1)
      .executeTakeFirst();
    if (!parent) throw new NodeExecutionError('Execução pai não encontrada');

    const target = await this.db
      .selectFrom('workflows as w')
      .leftJoin('workflow_versions as v', (join) =>
        join.onRef('v.workflow_id', '=', 'w.id').onRef('v.version', '=', 'w.published_version'),
      )
      .select(['w.id', 'w.name', 'w.project_id', 'w.active', 'w.published_version', 'v.definition'])
      .where('w.id', '=', request.workflowId)
      .where('w.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!target) throw new NodeExecutionError('Workflow do sub-workflow não encontrado');
    if (target.published_version === null || !target.definition) {
      throw new NodeExecutionError(
        `O workflow "${target.name}" não está publicado: publique-o para usá-lo como sub-workflow`,
      );
    }
    const definition = target.definition as WorkflowDefinition;
    const trigger = definition.nodes.find((n) => n.type === 'trigger.executeWorkflow');
    if (!trigger) {
      throw new NodeExecutionError(
        `O workflow "${target.name}" não tem o gatilho "Quando chamado por outro workflow"`,
      );
    }

    const owner = parent.triggered_by ?? parent.created_by;
    await this.checkPermission(owner, parent.project_id, target.project_id, target.name);

    // FR-010: profundidade e recursão (o alvo não pode ser um ancestral, nem o próprio pai).
    const depth = parent.depth + 1;
    if (depth > this.config.execution.maxSubworkflowDepth) {
      throw new NodeExecutionError(
        `Limite de ${String(this.config.execution.maxSubworkflowDepth)} níveis de sub-workflow excedido`,
      );
    }
    const ancestors = await this.ancestorWorkflows(parent.workflow_id, parent.parent_execution_id);
    if (ancestors.has(target.id)) {
      throw new NodeExecutionError(
        `Recursão detectada: o workflow "${target.name}" já está na cadeia desta execução`,
      );
    }

    const executionId = await this.createExecution({
      workflowId: target.id,
      projectId: target.project_id,
      version: target.published_version,
      definition,
      owner,
      parentExecutionId,
      depth,
      status: request.wait ? 'running' : 'queued',
    });
    const job: ExecutionJob = {
      executionId,
      workflow: {
        id: target.id,
        name: target.name,
        projectId: target.project_id,
        active: target.active,
      },
      definition,
      mode: 'production',
      triggerItems: structuredClone(request.items),
      startNodeId: trigger.id,
    };
    if (!request.wait) {
      await this.moduleRef
        .get<SubWorkflowQueue>(SUBWORKFLOW_QUEUE, { strict: false })
        .dispatch(job);
      return { executionId, status: 'queued', items: [] };
    }
    const outcome = await runInline(job, request.signal);
    if (outcome.status === 'success') {
      return { executionId, status: 'success', items: outcome.lastOutput ?? [] };
    }
    if (outcome.status === 'waiting') {
      throw new NodeExecutionError(
        `O sub-workflow "${target.name}" entrou em espera; para aguardar o término, ele não pode pausar (use "Aguardar o término" desligado)`,
      );
    }
    throw new NodeExecutionError(
      `O sub-workflow "${target.name}" ${outcome.status === 'cancelled' ? 'foi cancelado' : 'falhou'}: ${outcome.error?.message ?? 'erro desconhecido'}`,
      { description: `Execução filha ${executionId}` },
    );
  }

  /**
   * Mesmo projeto: quem disparou o pai já executa ali. Outro projeto: o dono precisa ter
   * `workflow:execute` como membro do projeto do alvo.
   */
  private async checkPermission(
    owner: string | null,
    parentProjectId: string,
    targetProjectId: string,
    targetName: string,
  ): Promise<void> {
    if (targetProjectId === parentProjectId) return;
    const membership = owner
      ? await this.db
          .selectFrom('project_members as m')
          .innerJoin('roles as r', 'r.id', 'm.role_id')
          .select('r.permissions')
          .where('m.project_id', '=', targetProjectId)
          .where('m.user_id', '=', owner)
          .executeTakeFirst()
      : undefined;
    if (!membership?.permissions.includes('workflow:execute')) {
      throw new NodeExecutionError(
        `Sem permissão para executar o workflow "${targetName}" (outro projeto): o dono desta execução precisa poder executar no projeto dele`,
      );
    }
  }

  private async ancestorWorkflows(
    workflowId: string,
    parentExecutionId: string | null,
  ): Promise<Set<string>> {
    const ids = new Set([workflowId]);
    let next = parentExecutionId;
    for (let i = 0; next && i <= this.config.execution.maxSubworkflowDepth; i++) {
      const row = await this.db
        .selectFrom('executions')
        .select(['workflow_id', 'parent_execution_id'])
        .where('id', '=', next)
        .limit(1)
        .executeTakeFirst();
      if (!row) break;
      ids.add(row.workflow_id);
      next = row.parent_execution_id;
    }
    return ids;
  }

  private async createExecution(input: {
    workflowId: string;
    projectId: string;
    version: number;
    definition: WorkflowDefinition;
    owner: string | null;
    parentExecutionId: string;
    depth: number;
    status: 'running' | 'queued';
  }): Promise<string> {
    const insert = () =>
      this.db
        .insertInto('executions')
        .values({
          workflow_id: input.workflowId,
          project_id: input.projectId,
          workflow_version: input.version,
          mode: 'production',
          trigger_type: SUBWORKFLOW_TRIGGER_TYPE,
          triggered_by: input.owner,
          status: input.status,
          definition: JSON.stringify(input.definition),
          parent_execution_id: input.parentExecutionId,
          depth: input.depth,
          ...(input.status === 'running' && { heartbeat_at: new Date() }),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    try {
      return (await insert()).id;
    } catch (err) {
      if ((err as { code?: string }).code !== NO_PARTITION) throw err;
      await sql`SELECT olly_ensure_partitions(2)`.execute(this.db);
      return (await insert()).id;
    }
  }
}
