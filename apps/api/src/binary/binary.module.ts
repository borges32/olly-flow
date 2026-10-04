import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { S3BinaryStorage } from './s3-binary-store.js';

export const BINARY_STORAGE = Symbol('BINARY_STORAGE');

/** Object storage dos binários (FR-010); `null` quando o S3 não está configurado. */
@Global()
@Module({
  providers: [
    {
      provide: BINARY_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => (config.s3 ? new S3BinaryStorage(config.s3) : null),
    },
  ],
  exports: [BINARY_STORAGE],
})
export class BinaryModule implements OnApplicationShutdown {
  constructor(@Inject(BINARY_STORAGE) private readonly storage: S3BinaryStorage | null) {}

  onApplicationShutdown(): void {
    this.storage?.destroy();
  }
}
