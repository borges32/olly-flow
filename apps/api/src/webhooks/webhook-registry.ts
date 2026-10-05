import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Db } from '@olly/db';
import type { WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { createRedisConnection } from '../core/redis.js';
import { DB, REDIS } from '../core/tokens.js';
import { matchPath, specificity } from './paths.js';

/** Rota de produção: caminho + método → workflow publicado e nó de webhook. */
export interface WebhookRoute {
  key: string;
  method: string;
  path: string;
  workflow: { id: string; name: string; project_id: string; version: number; active: boolean };
  definition: WorkflowDefinition;
  node: WorkflowNode;
}

export interface WebhookMatch<T> {
  route: T;
  params: Record<string, string>;
}

/** Casa método e caminho entre rotas; a mais específica vence. */
export function findRoute<T extends { method: string; path: string }>(
  routes: Iterable<T>,
  method: string,
  path: string,
): WebhookMatch<T> | null {
  let best: WebhookMatch<T> | null = null;
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchPath(route.path, path);
    if (params && (!best || specificity(route.path) > specificity(best.route.path))) {
      best = { route, params };
    }
  }
  return best;
}

/** Canal Redis que avisa as instâncias da API para recarregar as rotas (spec 006). */
const ROUTES_CHANGED_CHANNEL = 'olly:webhook-routes-changed';

/**
 * Rotas de webhook dos workflows publicados (spec 005, plan §3), em cache. A publicação, a
 * despublicação e a exclusão de workflow recarregam o cache, nesta e nas demais instâncias da
 * API (aviso pelo Redis, spec 006).
 */
@Injectable()
export class WebhookRegistry implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('WebhookRegistry');
  private routes?: Promise<WebhookRoute[]>;
  private subscriber?: Redis;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    const subscriber = createRedisConnection(this.config.redisUrl, 'webhook-routes');
    this.subscriber = subscriber;
    subscriber.on('message', () => {
      this.routes = undefined;
    });
    const subscribed = subscriber.subscribe(ROUTES_CHANGED_CHANNEL).catch((error: unknown) => {
      this.logger.warn(`Assinatura das mudanças de rotas falhou: ${String(error)}`);
    });
    await Promise.race([subscribed, new Promise((resolve) => setTimeout(resolve, 2000).unref())]);
  }

  onApplicationShutdown(): void {
    this.subscriber?.disconnect();
  }

  reload(): void {
    this.routes = undefined;
    this.redis.publish(ROUTES_CHANGED_CHANNEL, '1').catch((error: unknown) => {
      this.logger.warn(
        `Outras instâncias não foram avisadas da mudança de rotas: ${String(error)}`,
      );
    });
  }

  async match(method: string, path: string): Promise<WebhookMatch<WebhookRoute> | null> {
    return findRoute(await this.load(), method, path);
  }

  /** Há rota publicada no caminho com outro método (para o preflight de CORS). */
  async anyMethod(path: string): Promise<WebhookMatch<WebhookRoute> | null> {
    const routes = await this.load();
    for (const method of new Set(routes.map((r) => r.method))) {
      const found = findRoute(routes, method, path);
      if (found) return found;
    }
    return null;
  }

  private load(): Promise<WebhookRoute[]> {
    this.routes ??= this.fetch().catch((error: unknown) => {
      this.routes = undefined;
      throw error;
    });
    return this.routes;
  }

  private async fetch(): Promise<WebhookRoute[]> {
    const rows = await this.db
      .selectFrom('webhooks as wh')
      .innerJoin('workflows as w', 'w.id', 'wh.workflow_id')
      .innerJoin('workflow_versions as v', (join) =>
        join.onRef('v.workflow_id', '=', 'w.id').onRef('v.version', '=', 'w.published_version'),
      )
      .select([
        'wh.id',
        'wh.node_id',
        'wh.method',
        'wh.path',
        'w.id as workflow_id',
        'w.name',
        'w.project_id',
        'w.published_version',
        'v.definition',
      ])
      .where('wh.active', '=', true)
      .where('w.active', '=', true)
      .where('w.deleted_at', 'is', null)
      .execute();
    return rows.flatMap((r) => {
      const definition = r.definition as WorkflowDefinition;
      const node = definition.nodes.find((n) => n.id === r.node_id);
      if (!node || r.published_version === null) return [];
      return [
        {
          key: r.id,
          method: r.method,
          path: r.path,
          workflow: {
            id: r.workflow_id,
            name: r.name,
            project_id: r.project_id,
            version: r.published_version,
            active: true,
          },
          definition,
          node,
        },
      ];
    });
  }
}
