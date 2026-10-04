import { Module } from '@nestjs/common';
import { WorkflowsController } from './workflows.controller.js';
import { WorkflowsService } from './workflows.service.js';

@Module({ controllers: [WorkflowsController], providers: [WorkflowsService] })
export class WorkflowsModule {}
