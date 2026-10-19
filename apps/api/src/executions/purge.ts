import type { Logger } from '@nestjs/common';
import type { Db } from '@olly/db';
import type { S3BinaryStorage } from '../binary/s3-binary-store.js';
import { executionPrefix } from './node-data.js';

export interface PurgeResult {
  executions: number;
  nodes: number;
  mcpCalls: number;
  objects: number;
}

/**
 * Remove execuções inteiras e todos os seus dados (spec 009, retenção; spec 026, exclusão):
 * objetos no armazenamento (`executions/<id>/`), nós, payloads da fila, estado de espera,
 * chamadas MCP, passos do agente, pedidos de aprovação e a própria execução. O uso de LLM
 * (`llm_usage`) fica: é contabilidade e cota do projeto, não histórico da execução.
 */
export async function purgeExecutions(
  db: Db,
  storage: S3BinaryStorage | null,
  ids: string[],
  logger?: Pick<Logger, 'warn'>,
): Promise<PurgeResult> {
  const result: PurgeResult = { executions: 0, nodes: 0, mcpCalls: 0, objects: 0 };
  if (ids.length === 0) return result;
  if (storage) {
    for (const id of ids) {
      try {
        result.objects += await storage.deletePrefix(executionPrefix(id));
      } catch (error) {
        logger?.warn(`Objetos da execução ${id} não removidos: ${String(error)}`);
      }
    }
  }
  const nodes = await db
    .deleteFrom('node_executions')
    .where('execution_id', 'in', ids)
    .executeTakeFirst();
  await db.deleteFrom('execution_payloads').where('execution_id', 'in', ids).execute();
  await db.deleteFrom('execution_state').where('execution_id', 'in', ids).execute();
  const calls = await db
    .deleteFrom('mcp_calls')
    .where('execution_id', 'in', ids)
    .executeTakeFirst();
  await db.deleteFrom('agent_steps').where('execution_id', 'in', ids).execute();
  await db.deleteFrom('approval_requests').where('execution_id', 'in', ids).execute();
  const executions = await db.deleteFrom('executions').where('id', 'in', ids).executeTakeFirst();
  result.nodes = Number(nodes.numDeletedRows);
  result.mcpCalls = Number(calls.numDeletedRows);
  result.executions = Number(executions.numDeletedRows);
  return result;
}
