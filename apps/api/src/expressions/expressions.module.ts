import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { ExpressionEvaluator } from '@olly/expressions';
import { TaskRunnerClient } from '@olly/task-runner';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

export const EXPRESSION_EVALUATOR = Symbol('EXPRESSION_EVALUATOR');

/** Avaliador de expressões: o task runner em processo separado (ADR-0003, plan §2). */
@Global()
@Module({
  providers: [
    {
      provide: EXPRESSION_EVALUATOR,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ExpressionEvaluator => {
        const logger = new Logger('TaskRunner');
        return new TaskRunnerClient({
          timeoutMs: config.execution.expressionTimeoutMs,
          memoryMb: config.execution.isolateMemoryMb,
          logger: {
            info: (m) => {
              logger.log(m);
            },
            warn: (m) => {
              logger.warn(m);
            },
          },
        });
      },
    },
  ],
  exports: [EXPRESSION_EVALUATOR],
})
export class ExpressionsModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ExpressionsModule.name);

  constructor(@Inject(EXPRESSION_EVALUATOR) private readonly evaluator: TaskRunnerClient) {}

  onModuleInit(): void {
    // Sobe o runner em segundo plano; se falhar, a primeira avaliação tenta de novo.
    this.evaluator.start().catch((error: unknown) => {
      this.logger.warn(`Task runner não iniciou: ${String(error)}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.evaluator.stop();
  }
}
