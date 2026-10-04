import { Global, Module } from '@nestjs/common';
import { EnvKeyProvider } from '@olly/db';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { CredentialsController } from './credentials.controller.js';
import { CredentialsService, KEY_PROVIDER } from './credentials.service.js';

/**
 * Credenciais (spec 004). A chave mestra vem de um `KeyProvider` substituível: `env` nesta spec;
 * Vault/KMS quando a ADR-0007 for decidida (spec 009).
 */
@Global()
@Module({
  controllers: [CredentialsController],
  providers: [
    {
      provide: KEY_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new EnvKeyProvider(config.credentials.masterKey),
    },
    CredentialsService,
  ],
  exports: [CredentialsService],
})
export class CredentialsModule {}
