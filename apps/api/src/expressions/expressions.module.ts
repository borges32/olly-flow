import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { CodeRunner, ExpressionEvaluator } from '@olly/expressions';
import { TaskRunnerClient } from '@olly/task-runner';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

export const EXPRESSION_EVALUATOR = Symbol('EXPRESSION_EVALUATOR');
/** Sandbox do nó de código (spec 005): o mesmo processo do task runner. */
export const CODE_RUNNER = Symbol('CODE_RUNNER');

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
          codeTimeoutMs: config.code.timeoutMs,
          codeMemoryMb: config.code.memoryMb,
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
    {
      provide: CODE_RUNNER,
      inject: [EXPRESSION_EVALUATOR],
      useFactory: (runner: TaskRunnerClient): CodeRunner => runner,
    },
  ],
  exports: [EXPRESSION_EVALUATOR, CODE_RUNNER],
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
