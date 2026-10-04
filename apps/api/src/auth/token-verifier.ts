import { Inject, Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { DependencyUnavailableError, UnauthenticatedError } from '../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { accessTokenClaimsSchema, type AccessTokenClaims } from './auth.types.js';

const ALLOWED_ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'EdDSA',
];
const DISCOVERY_TIMEOUT_MS = 3000;

const discoverySchema = z.object({ issuer: z.string(), jwks_uri: z.url() });

/**
 * Valida access tokens de qualquer IdP OIDC (FR-008): descobre o `jwks_uri` pelo documento
 * `.well-known/openid-configuration` do emissor e verifica assinatura, `iss`, `aud` e `exp`.
 * A descoberta é preguiçosa: com o IdP fora do ar a API sobe e continua respondendo `/health`.
 */
@Injectable()
export class OidcTokenVerifier {
  private readonly logger = new Logger(OidcTokenVerifier.name);
  private jwks?: Promise<JWTVerifyGetKey>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private get discoveryUrl(): string {
    const base = this.config.oidc.discoveryUrl ?? this.config.oidc.issuerUrl;
    return `${base}/.well-known/openid-configuration`;
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    const jwks = await this.getJwks();
    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer: this.config.oidc.issuerUrl,
        audience: this.config.oidc.audience,
        algorithms: ALLOWED_ALGORITHMS,
        requiredClaims: ['sub', 'exp'],
        clockTolerance: 5,
      }));
    } catch (error) {
      if (error instanceof errors.JWKSTimeout || !(error instanceof errors.JOSEError)) {
        this.logger.warn(`Falha ao obter chaves do IdP: ${String(error)}`);
        throw new DependencyUnavailableError('Provedor de identidade indisponível', {
          cause: error,
        });
      }
      throw new UnauthenticatedError(describeJoseError(error), { cause: error });
    }
    const claims = accessTokenClaimsSchema.safeParse(payload);
    if (!claims.success) throw new UnauthenticatedError('Token com claims inválidas');
    return claims.data;
  }

  /** Usado pelo `/health`: o emissor responde ao documento de descoberta? */
  async isIssuerReachable(): Promise<boolean> {
    try {
      const res = await fetch(this.discoveryUrl, {
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private getJwks(): Promise<JWTVerifyGetKey> {
    this.jwks ??= this.discover().catch((error: unknown) => {
      // Não guarda a falha: a próxima requisição tenta de novo.
      this.jwks = undefined;
      this.logger.warn(`Descoberta OIDC falhou: ${String(error)}`);
      throw new DependencyUnavailableError('Provedor de identidade indisponível', { cause: error });
    });
    return this.jwks;
  }

  private async discover(): Promise<JWTVerifyGetKey> {
    const res = await fetch(this.discoveryUrl, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${this.discoveryUrl}`);
    const doc = discoverySchema.parse(await res.json());
    if (doc.issuer.replace(/\/+$/, '') !== this.config.oidc.issuerUrl) {
      throw new Error(`issuer divergente na descoberta: ${doc.issuer}`);
    }
    return createRemoteJWKSet(new URL(doc.jwks_uri), { timeoutDuration: DISCOVERY_TIMEOUT_MS });
  }
}

function describeJoseError(error: errors.JOSEError): string {
  if (error instanceof errors.JWTExpired) return 'Token expirado';
  if (error instanceof errors.JWTClaimValidationFailed)
    return `Token inválido: claim ${error.claim}`;
  return 'Token inválido';
}
