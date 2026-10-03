import { z } from 'zod';

/** Referência a um binário guardado no object storage; o conteúdo nunca trafega no item. */
export interface BinaryRef {
  id: string;
  mimeType: string;
  fileName?: string;
  size?: number;
}

export interface Item {
  json: Record<string, unknown>;
  binary?: Record<string, BinaryRef>;
  /** Item de entrada que originou este. */
  pairedItem?: { item: number; input?: number };
}

/** Porta -> itens: `{ main }`, `{ true, false }`, `{ output0.. }`, `{ error }`. */
export type NodeOutput = Record<string, Item[]>;

export type PortKind = 'main' | 'ai_languageModel' | 'ai_memory' | 'ai_tool';

export interface PortDef {
  name: string;
  displayName?: string;
  kind: PortKind;
  required?: boolean;
}

export interface WorkflowNodeSettings {
  retry?: { maxTries: number; waitMs: number; backoff?: 'fixed' | 'exponential' };
  timeoutMs?: number;
  onError?: 'stop' | 'continue' | 'errorOutput';
  parallelItems?: { enabled: boolean; concurrency: number };
}

export interface WorkflowNode {
  id: string;
  type: string;
  /** Único no workflow; usado em `$('Nome')`. */
  name: string;
  params: Record<string, unknown>;
  credentialId?: string;
  position: [number, number];
  disabled?: boolean;
  settings?: WorkflowNodeSettings;
}

export interface Edge {
  id: string;
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
}

export interface WorkflowSettings {
  timeoutSec?: number;
  maxParallel?: number;
  saveExecutionData?: 'all' | 'errorsOnly' | 'none';
  errorWorkflowId?: string;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: Edge[];
  settings: WorkflowSettings;
  /** Itens fixados por id do nó (spec 003). */
  pinData?: Record<string, Item[]>;
}

export const EXECUTION_STATUSES = [
  'queued',
  'running',
  'waiting',
  'success',
  'error',
  'cancelled',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const NODE_EXECUTION_STATUSES = [
  'running',
  'success',
  'error',
  'skipped',
  'waiting',
  'cancelled',
] as const;
export type NodeExecutionStatus = (typeof NODE_EXECUTION_STATUSES)[number];

const nonEmpty = z.string().min(1);

export const binaryRefSchema = z.object({
  id: nonEmpty,
  mimeType: nonEmpty,
  fileName: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
}) satisfies z.ZodType<BinaryRef>;

export const itemSchema = z.object({
  json: z.record(z.string(), z.unknown()),
  binary: z.record(z.string(), binaryRefSchema).optional(),
  pairedItem: z
    .object({
      item: z.number().int().nonnegative(),
      input: z.number().int().nonnegative().optional(),
    })
    .optional(),
}) satisfies z.ZodType<Item>;

export const nodeOutputSchema = z.record(
  z.string(),
  z.array(itemSchema),
) satisfies z.ZodType<NodeOutput>;

export const portDefSchema = z.object({
  name: nonEmpty,
  displayName: z.string().optional(),
  kind: z.enum(['main', 'ai_languageModel', 'ai_memory', 'ai_tool']),
  required: z.boolean().optional(),
}) satisfies z.ZodType<PortDef>;

export const workflowNodeSettingsSchema = z.object({
  retry: z
    .object({
      maxTries: z.number().int().min(1),
      waitMs: z.number().int().nonnegative(),
      backoff: z.enum(['fixed', 'exponential']).optional(),
    })
    .optional(),
  timeoutMs: z.number().int().positive().optional(),
  onError: z.enum(['stop', 'continue', 'errorOutput']).optional(),
  parallelItems: z
    .object({ enabled: z.boolean(), concurrency: z.number().int().min(1) })
    .optional(),
}) satisfies z.ZodType<WorkflowNodeSettings>;

export const workflowNodeSchema = z.object({
  id: nonEmpty,
  type: nonEmpty,
  name: nonEmpty,
  params: z.record(z.string(), z.unknown()),
  credentialId: z.string().optional(),
  position: z.tuple([z.number(), z.number()]),
  disabled: z.boolean().optional(),
  settings: workflowNodeSettingsSchema.optional(),
}) satisfies z.ZodType<WorkflowNode>;

export const edgeSchema = z.object({
  id: nonEmpty,
  from: nonEmpty,
  fromPort: nonEmpty,
  to: nonEmpty,
  toPort: nonEmpty,
}) satisfies z.ZodType<Edge>;

export const workflowSettingsSchema = z.object({
  timeoutSec: z.number().int().positive().optional(),
  maxParallel: z.number().int().min(1).optional(),
  saveExecutionData: z.enum(['all', 'errorsOnly', 'none']).optional(),
  errorWorkflowId: z.string().optional(),
}) satisfies z.ZodType<WorkflowSettings>;

/**
 * Valida a forma da definição e as invariantes que não dependem do catálogo de nós:
 * ids e nomes únicos, arestas e pinData (indexado por id do nó) apontando para nós existentes.
 * A validação de tipos de nó e portas cabe ao registro de nós (spec 002).
 */
export const workflowDefinitionSchema = z
  .object({
    nodes: z.array(workflowNodeSchema),
    edges: z.array(edgeSchema),
    settings: workflowSettingsSchema,
    pinData: z.record(z.string(), z.array(itemSchema)).optional(),
  })
  .superRefine((def, ctx) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    def.nodes.forEach((node, i) => {
      if (ids.has(node.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'id'],
          message: `id de nó duplicado: ${node.id}`,
        });
      }
      if (names.has(node.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'name'],
          message: `nome de nó duplicado: ${node.name}`,
        });
      }
      ids.add(node.id);
      names.add(node.name);
    });
    const edgeIds = new Set<string>();
    def.edges.forEach((edge, i) => {
      if (edgeIds.has(edge.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['edges', i, 'id'],
          message: `id de aresta duplicado: ${edge.id}`,
        });
      }
      edgeIds.add(edge.id);
      for (const end of ['from', 'to'] as const) {
        if (!ids.has(edge[end])) {
          ctx.addIssue({
            code: 'custom',
            path: ['edges', i, end],
            message: `nó inexistente: ${edge[end]}`,
          });
        }
      }
    });
    for (const nodeId of Object.keys(def.pinData ?? {})) {
      if (!ids.has(nodeId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['pinData', nodeId],
          message: `pinData de nó inexistente: ${nodeId}`,
        });
      }
    }
  }) satisfies z.ZodType<WorkflowDefinition>;
