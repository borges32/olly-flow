import { Controller, Get, Global, Inject, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createNodeRegistry, type NodeDescription, type NodeRegistry } from '@olly/nodes';
import { Authenticated } from '../auth/public.decorator.js';

export const NODE_REGISTRY = Symbol('NODE_REGISTRY');

@ApiTags('nós')
@ApiBearerAuth()
@Controller()
export class NodeTypesController {
  constructor(@Inject(NODE_REGISTRY) private readonly registry: NodeRegistry) {}

  /** Catálogo de tipos de nó para o editor (spec 002, FR-006). */
  @Authenticated()
  @Get('node-types')
  list(): NodeDescription[] {
    return this.registry.list();
  }
}

@Global()
@Module({
  controllers: [NodeTypesController],
  providers: [{ provide: NODE_REGISTRY, useFactory: () => createNodeRegistry() }],
  exports: [NODE_REGISTRY],
})
export class NodeTypesModule {}
