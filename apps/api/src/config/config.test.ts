import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const valid = {
  DATABASE_URL: 'postgres://olly:segredo-do-banco@localhost:5432/olly',
  REDIS_URL: 'redis://localhost:6379',
  OIDC_ISSUER_URL: 'http://localhost:8080/realms/olly/',
  OIDC_AUDIENCE: 'olly-api',
};

describe('configuração da API (validação zod na inicialização)', () => {
  it('aplica padrões seguros e normaliza o emissor', () => {
    const config = loadConfig(valid);
    expect(config).toMatchObject({
      env: 'production',
      port: 3000,
      logLevel: 'info',
      oidc: { issuerUrl: 'http://localhost:8080/realms/olly', audience: 'olly-api' },
    });
  });

  it('falha na inicialização se faltar variável obrigatória', () => {
    expect(() => loadConfig({ ...valid, OIDC_AUDIENCE: undefined })).toThrow(ConfigError);
  });

  it('rejeita URL com protocolo errado', () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: 'mysql://localhost/olly' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('NFR-002: a mensagem de erro não expõe valores das variáveis', () => {
    try {
      loadConfig({ ...valid, API_PORT: 'abc' });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toMatch(/API_PORT/);
      expect(String(error)).not.toMatch(/segredo-do-banco/);
    }
  });
});
