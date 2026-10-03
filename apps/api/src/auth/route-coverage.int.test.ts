import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestContext, type TestContext } from '../testing/test-app.js';
import { IS_AUTHENTICATED, IS_PUBLIC } from './public.decorator.js';

interface RouteInfo {
  handler: string;
  method: string;
  path: string;
  isPublic: boolean;
  isAuthenticated: boolean;
}

let ctx: TestContext;
let routes: RouteInfo[];

beforeAll(async () => {
  ctx = await startTestContext();
  const discovery = new DiscoveryService(ctx.app.get(ModulesContainer));
  const reflector = ctx.app.get(Reflector);
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
      const flag = (key: string) =>
        reflector.getAllAndOverride<boolean | undefined>(key, [handler, controller]) === true;
      return [
        {
          handler: `${controller.name}.${name}`,
          method: RequestMethod[method],
          path: `/${[base, path].join('/')}`.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1'),
          isPublic: flag(IS_PUBLIC),
          isAuthenticated: flag(IS_AUTHENTICATED),
        },
      ];
    });
  });
});
afterAll(async () => {
  await ctx.close();
});

describe('FR-004 (constituição, Art. III.4): toda rota declara o acesso exigido', () => {
  it('FR-004: encontra as rotas da API', () => {
    expect(routes.map((r) => r.handler).sort()).toEqual([
      'HealthController.check',
      'MeController.me',
    ]);
  });

  it('FR-004: toda rota é @Public() ou @Authenticated()', () => {
    const undeclared = routes
      .filter((r) => !r.isPublic && !r.isAuthenticated)
      .map((r) => r.handler);
    expect(undeclared).toEqual([]);
  });

  it('FR-004: toda rota não pública nega acesso sem token (401)', async () => {
    const protectedRoutes = routes.filter((r) => !r.isPublic);
    expect(protectedRoutes.length).toBeGreaterThan(0);
    for (const route of protectedRoutes) {
      const res = await ctx.app.inject({
        method: route.method as 'GET',
        url: `/api/v1${route.path}`,
      });
      expect(res.statusCode, `${route.method} ${route.path}`).toBe(401);
    }
  });
});
