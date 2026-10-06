import { Global, Module } from '@nestjs/common';
import { createKeyRing } from '@olly/db';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { CredentialsController } from './credentials.controller.js';
import { CredentialsService, KEY_PROVIDER } from './credentials.service.js';

/**
 * Credenciais (spec 004). A chave mestra vem de um `KeyProvider` substituível, escolhido por
 * configuração (spec 009, FR-001): `env` ou `vault` (Vault Transit, ADR-0007 pendente).
 */
@Global()
@Module({
  controllers: [CredentialsController],
  providers: [
    {
      provide: KEY_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        createKeyRing({
          provider: config.credentials.keyProvider,
          ...(config.credentials.masterKey && { masterKey: config.credentials.masterKey }),
          ...(config.credentials.masterKeyVersion && {
            masterKeyVersion: config.credentials.masterKeyVersion,
          }),
          ...(config.credentials.previousMasterKeys && {
            previousMasterKeys: config.credentials.previousMasterKeys,
          }),
          ...(config.credentials.vault && { vault: config.credentials.vault }),
        }),
    },
    CredentialsService,
  ],
  exports: [CredentialsService, KEY_PROVIDER],
})
export class CredentialsModule {}
