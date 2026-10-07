import { Module } from '@nestjs/common';
import { ExecutionsModule } from '../executions/executions.module.js';
import { WorkflowsModule } from '../workflows/workflows.module.js';
import { WorkflowIoController } from './workflow-io.controller.js';
import { WorkflowIoService } from './workflow-io.service.js';

/** Spec 015: baixar e importar workflows em JSON (formato do Olly Flow e do N8N). */
@Module({
  imports: [WorkflowsModule, ExecutionsModule],
  controllers: [WorkflowIoController],
  providers: [WorkflowIoService],
})
export class WorkflowIoModule {}
