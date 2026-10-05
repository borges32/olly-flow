import { Injectable } from '@nestjs/common';
import type { WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import type { AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ConflictError } from '../common/errors.js';
import { findRoute, type WebhookMatch } from './webhook-registry.js';

export const LISTEN_MS = 2 * 60_000;

export interface TestListener {
  method: string;
  path: string;
  workflowId: string;
  projectId: string;
  definition: WorkflowDefinition;
  node: WorkflowNode;
  /** A execução para no nó de webhook (escuta iniciada no painel do nó). */
  stopAtNode: boolean;
  user: AuthenticatedUser;
  audit: AuditContext;
  expiresAt: number;
}

/**
 * Escutas do webhook de teste (spec 005, FR-007, plan §3), em memória: o editor escuta por 2 min
 * a definição atual (mesmo não salva); a primeira chamada consome a escuta do workflow.
 */
@Injectable()
export class TestListeners {
  private listeners: TestListener[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  listen(entries: Omit<TestListener, 'expiresAt'>[]): number {
    this.prune();
    for (const entry of entries) {
      const taken = this.listeners.find(
        (l) =>
          l.method === entry.method && l.path === entry.path && l.workflowId !== entry.workflowId,
      );
      if (taken)
        throw new ConflictError(
          `Outro workflow está escutando ${entry.method} /webhook-test/${entry.path}`,
        );
    }
    const workflowIds = new Set(entries.map((e) => e.workflowId));
    const expiresAt = this.now() + LISTEN_MS;
    this.listeners = [
      ...this.listeners.filter((l) => !workflowIds.has(l.workflowId)),
      ...entries.map((e) => ({ ...e, expiresAt })),
    ];
    return expiresAt;
  }

  stop(workflowId: string): void {
    this.listeners = this.listeners.filter((l) => l.workflowId !== workflowId);
  }

  match(method: string, path: string): WebhookMatch<TestListener> | null {
    this.prune();
    return findRoute(this.listeners, method, path);
  }

  anyMethod(path: string): WebhookMatch<TestListener> | null {
    this.prune();
    for (const method of new Set(this.listeners.map((l) => l.method))) {
      const found = findRoute(this.listeners, method, path);
      if (found) return found;
    }
    return null;
  }

  /** A chamada recebida encerra a escuta do workflow (como no N8N). */
  consume(workflowId: string): void {
    this.stop(workflowId);
  }

  private prune(): void {
    const now = this.now();
    this.listeners = this.listeners.filter((l) => l.expiresAt > now);
  }
}
