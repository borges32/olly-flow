import { AiGatewayFactory } from './ai-gateway.service.js';
import { ApprovalsService } from './approvals.service.js';

/**
 * Execução: gateway de IA entregue ao motor e os pedidos de aprovação (spec 011). Usado pela
 * API (execução em processo) e pelos workers. `ExecutionWaits` e `ExecutionEventSink` vêm do
 * módulo de execuções (API) ou do worker. Fica fora de `ai.module.ts` para não criar ciclo de
 * importação com o módulo de execuções.
 */
export const AI_RUNTIME_PROVIDERS = [AiGatewayFactory, ApprovalsService];
