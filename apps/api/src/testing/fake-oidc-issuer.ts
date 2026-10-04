import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWTPayload } from 'jose';

export interface FakeIssuer {
  /** Valor do `iss` nos tokens. */
  issuerUrl: string;
  /** Onde o IdP falso responde (descoberta e JWKS). */
  serverUrl: string;
  /** Assina um access token com a chave publicada no JWKS. */
  sign(claims: JWTPayload, options?: SignOptions): Promise<string>;
  /** Assina com uma chave que não está no JWKS. */
  signWithForeignKey(claims: JWTPayload, options?: SignOptions): Promise<string>;
  close(): Promise<void>;
}

export interface SignOptions {
  issuer?: string;
  audience?: string;
  /** `null` omite a claim `exp`. */
  expiresIn?: string | number | null;
}

/**
 * IdP OIDC mínimo para testes: publica `.well-known/openid-configuration` e o JWKS.
 * Exercita o mesmo caminho genérico usado com o IdP de desenvolvimento (FR-008).
 */
export async function startFakeIssuer(
  audience: string,
  options: { publicIssuer?: string } = {},
): Promise<FakeIssuer> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const foreign = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

  let issuerUrl = '';
  const server: Server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/.well-known/openid-configuration') {
      res.end(JSON.stringify({ issuer: issuerUrl, jwks_uri: `${serverUrl}/jwks` }));
    } else if (req.url === '/jwks') {
      res.end(JSON.stringify({ keys: [jwk] }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // `publicIssuer` simula o IdP atrás de outro endereço: o `iss` difere de onde ele responde.
  issuerUrl = options.publicIssuer ?? serverUrl;

  const signWith = (key: CryptoKey, claims: JWTPayload, options: SignOptions = {}) => {
    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })
      .setIssuer(options.issuer ?? issuerUrl)
      .setAudience(options.audience ?? audience)
      .setIssuedAt();
    if (options.expiresIn !== null) jwt.setExpirationTime(options.expiresIn ?? '5m');
    return jwt.sign(key);
  };

  return {
    issuerUrl,
    serverUrl,
    sign: (claims, options) => signWith(privateKey, claims, options),
    signWithForeignKey: (claims, options) => signWith(foreign.privateKey, claims, options),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
