import { randomBytes } from 'node:crypto';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { isPermission } from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { IS_AUTHENTICATED, IS_PUBLIC } from '../auth/public.decorator.js';
import {
  REQUIRED_PERMISSION,
  resourceOf,
  type PermissionRequirement,
} from './require-permission.decorator.js';

interface RouteInfo {
  handler: string;
  method: string;
  path: string;
  isPublic: boolean;
  isAuthenticated: boolean;
  requirement?: PermissionRequirement;
}

let app: NestFastifyApplication;
let routes: RouteInfo[];

// Sem banco nem Redis: o teste só inspeciona metadados e respostas anteriores a qualquer consulta.
beforeAll(async () => {
  app = await createApp({
    env: 'test',
    logLevel: 'silent',
    port: 0,
    host: '127.0.0.1',
    databaseUrl: 'postgres://ninguem:x@127.0.0.1:1/nada',
    redisUrl: 'redis://127.0.0.1:1',
    oidc: { issuerUrl: 'http://127.0.0.1:1', audience: 'olly-api', adminGroup: 'admin' },
    execution: {
      expressionTimeoutMs: 100,
      isolateMemoryMb: 64,
      nodeDataMaxBytes: 1_048_576,
      timezone: 'UTC',
      workflowTimeoutMs: 300_000,
      defaultMaxParallel: 8,
      maxLoopIterations: 10_000,
    },
    publicUrl: 'http://localhost:5173',
    credentials: { keyProvider: 'env', masterKey: randomBytes(32).toString('base64') },
    governance: {
      userInactiveDays: 90,
      inlineDataLimit: 262_144,
      maskingSalt: 'salt-de-teste-0123456789',
      retention: { dataDays: 30, metadataDays: 365 },
      maintenanceCron: '0 3 * * *',
    },
    http: { allowlist: [], maxResponseBytes: 50 * 1024 * 1024 },
    postgres: { poolMax: 5 },
    dispatcher: { maxConcurrent: 10 },
    queue: {
      testRunMode: 'inprocess',
      workerConcurrency: 1,
      workerShutdownTimeoutMs: 1000,
      workerPort: 0,
      projectMaxConcurrent: 20,
      heartbeatMs: 10_000,
      staleAfterMs: 60_000,
      sweepIntervalMs: 60_000,
      quotaRetryMs: 1000,
    },
    webhook: {
      maxBodyBytes: 16 * 1024 * 1024,
      responseTimeoutMs: 120_000,
      rateLimitPerMin: 120,
      requireAuth: false,
    },
    code: { timeoutMs: 30_000, memoryMb: 128 },
  });
  const discovery = new DiscoveryService(app.get(ModulesContainer));
  const reflector = app.get(Reflector);
  const scanner = new MetadataScanner();
  routes = discovery.getControllers().flatMap((wrapper) => {
    const instance = wrapper.instance as object | undefined;
    if (!instance) return [];
    const controller = instance.constructor;
    const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    return scanner.getAllMethodNames(prototype).flatMap((name) => {
      const handler = prototype[name] as (...args: unknown[]) => unknown;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      if (path === undefined) return [];
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
      const meta = (key: string): unknown =>
        reflector.getAllAndOverride(key, [handler, controller]);
      return [
        {
          handler: `${controller.name}.${name}`,
          method: RequestMethod[method],
          path: `/${[base, path].join('/')}`.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1'),
          isPublic: meta(IS_PUBLIC) === true,
          isAuthenticated: meta(IS_AUTHENTICATED) === true,
          requirement: meta(REQUIRED_PERMISSION) as PermissionRequirement | undefined,
        },
      ];
    });
  });
});
afterAll(async () => {
  await app.close();
});

describe('spec 002 — FR-012/SC-004: cobertura RBAC das rotas', () => {
  it('FR-012: encontra as rotas da API', () => {
    expect(routes.length).toBeGreaterThanOrEqual(15);
  });

  it('FR-012: toda rota é pública ou declara a permissão exigida', () => {
    const undeclared = routes.filter((r) => !r.isPublic && !r.isAuthenticated && !r.requirement);
    expect(undeclared.map((r) => `${r.method} ${r.path} (${r.handler})`)).toEqual([]);
  });

  it('FR-012: rota declara uma única forma de acesso', () => {
    const ambiguous = routes.filter(
      (r) =>
        [r.isPublic, r.isAuthenticated, r.requirement !== undefined].filter(Boolean).length > 1,
    );
    expect(ambiguous.map((r) => r.handler)).toEqual([]);
  });

  it('FR-012: permissões declaradas existem no catálogo', () => {
    const unknown = routes.flatMap((r) =>
      (r.requirement?.anyOf ?? []).filter((p) => !isPermission(p)),
    );
    expect(unknown).toEqual([]);
  });

  it('FR-012: rotas com escopo de recurso usam um parâmetro existente na rota', () => {
    for (const r of routes) {
      const scope = r.requirement?.scope;
      if (!scope || typeof scope === 'string') continue;
      const { param } = resourceOf(scope);
      expect(r.path, r.handler).toContain(`:${param}`);
    }
  });

  it('FR-012: toda rota não pública nega acesso sem token (401)', async () => {
    const uuid = '00000000-0000-4000-8000-000000000000';
    for (const route of routes.filter((r) => !r.isPublic)) {
      const res = await app.inject({
        method: route.method as 'GET',
        url: `/api/v1${route.path.replace(/:[A-Za-z]+/g, uuid)}`,
      });
      expect(res.statusCode, `${route.method} ${route.path}`).toBe(401);
    }
  });
});
