import { NodeParameterError, NodeWaitSignal } from '../../errors.js';
import type { NodeContext, NodeDefinition, NodeExecuteInput } from '../../types.js';
import type { NodeOutput } from '@olly/shared-types';

/** Esperas até este limite ficam em memória; acima, a execução é pausada (NFR-002). */
export const INLINE_WAIT_MS = 60_000;

const UNIT_MS = { seconds: 1000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;
type Unit = keyof typeof UNIT_MS;

/** Quanto falta esperar, em ms, a partir dos parâmetros (do primeiro item). */
export function waitDuration(ctx: NodeContext, now = Date.now()): { ms: number; until: Date } {
  if (ctx.getParam('resume', 0) === 'specificTime') {
    const raw = ctx.getParam('dateTime', 0);
    const until = new Date(typeof raw === 'string' || typeof raw === 'number' ? raw : NaN);
    if (Number.isNaN(until.getTime())) {
      throw new NodeParameterError('dateTime', 'informe uma data/hora válida (ISO 8601)');
    }
    return { ms: until.getTime() - now, until };
  }
  const amount = Number(ctx.getParam('amount', 0));
  const unit = ctx.getParam('unit', 0) as Unit;
  if (!Number.isFinite(amount) || amount < 0) {
    throw new NodeParameterError('amount', 'informe um número maior ou igual a zero');
  }
  if (!(unit in UNIT_MS)) throw new NodeParameterError('unit', `unidade desconhecida: ${unit}`);
  const ms = Math.round(amount * UNIT_MS[unit]);
  return { ms, until: new Date(now + ms) };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('Execução cancelada'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error('Execução cancelada'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function executeWait(input: NodeExecuteInput, ctx: NodeContext): Promise<NodeOutput> {
  const pass = (): NodeOutput => ({
    main: input.items.map((item, i) => ctx.helpers.pairedItem(item, i)),
  });
  // Retomada: o tempo já passou.
  if (ctx.resume) return pass();
  const { ms, until } = waitDuration(ctx);
  if (ms <= 0) return pass();
  if (ms <= INLINE_WAIT_MS) {
    await sleep(ms, ctx.signal);
    return pass();
  }
  // Espera longa: libera o worker; a execução retoma do estado salvo (FR-012).
  throw new NodeWaitSignal({
    reason: `Aguardando até ${until.toISOString()}`,
    resumeAt: until.toISOString(),
  });
}

/**
 * Espera (spec 008, FR-012, plan §5): por intervalo ou até uma data/hora. Até 60 s, em memória;
 * acima, a execução fica `waiting` sem ocupar o worker e retoma a partir do estado salvo.
 * Equivale ao `n8n-nodes-base.wait` (modos de tempo).
 */
export const waitNode: NodeDefinition = {
  type: 'flow.wait',
  version: 1,
  displayName: 'Esperar',
  description: 'Pausa a execução por um intervalo ou até uma data/hora.',
  icon: 'hourglass',
  category: 'flow',
  inputs: [{ name: 'main', kind: 'main' }],
  outputs: [{ name: 'main', kind: 'main' }],
  paramsSchema: {
    type: 'object',
    properties: {
      resume: {
        type: 'string',
        title: 'Retomar',
        description: '`timeInterval`: depois de um intervalo; `specificTime`: numa data/hora.',
        enum: ['timeInterval', 'specificTime'],
        default: 'timeInterval',
      },
      amount: {
        type: 'number',
        title: 'Quantidade',
        minimum: 0,
        default: 1,
        'x-display-options': { show: { resume: ['timeInterval'] } },
      },
      unit: {
        type: 'string',
        title: 'Unidade',
        enum: ['seconds', 'minutes', 'hours', 'days'],
        default: 'minutes',
        'x-display-options': { show: { resume: ['timeInterval'] } },
      },
      dateTime: {
        type: 'string',
        title: 'Data/hora',
        description: 'ISO 8601, ex.: 2026-10-06T14:30:00-03:00. Aceita expressão.',
        default: '',
        'x-display-options': { show: { resume: ['specificTime'] } },
      },
    },
  } as NodeDefinition['paramsSchema'],
  execute: executeWait,
};
