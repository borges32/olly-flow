import { CredentialCryptoError, EnvKeyProvider, KeyRing } from './crypto.js';
import { VaultTransitKeyProvider, type VaultOptions } from './vault.js';

export interface KeyRingOptions {
  /** Provedor que cifra as DEKs novas (OLLY_KEY_PROVIDER). */
  provider: 'env' | 'vault';
  /** OLLY_MASTER_KEY: obrigatória com `env`; com `vault`, só enquanto houver credenciais a migrar. */
  masterKey?: string;
  masterKeyVersion?: number;
  /** Chaves `env` anteriores (rotação), versão → base64. */
  previousMasterKeys?: Record<number, string>;
  vault?: VaultOptions;
}

/** Monta o chaveiro a partir da configuração (spec 009, FR-001: seleção por configuração). */
export function createKeyRing(options: KeyRingOptions): KeyRing {
  const env = options.masterKey
    ? new EnvKeyProvider(
        options.masterKey,
        options.masterKeyVersion ?? 1,
        options.previousMasterKeys ?? {},
      )
    : undefined;
  if (options.provider === 'env') {
    if (!env)
      throw new CredentialCryptoError('OLLY_MASTER_KEY é obrigatória com OLLY_KEY_PROVIDER=env');
    return new KeyRing(env);
  }
  if (!options.vault) throw new CredentialCryptoError('Configuração do Vault ausente');
  return new KeyRing(new VaultTransitKeyProvider(options.vault), env ? [env] : []);
}
