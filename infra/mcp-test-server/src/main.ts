import { startMcpTestServer, type McpTestAuth } from './server.js';

/**
 * Servidor MCP de teste no compose (spec 010, FR-013). Variáveis:
 * - `PORT` (3333) e `HOST` (0.0.0.0);
 * - `MUTATE_SCHEMA=1`: muda o schema de `soma` (demonstração do bloqueio por snapshot);
 * - `MCP_BEARER_TOKEN`: exige `Authorization: Bearer`;
 * - `MCP_OAUTH_ISSUER` (+ `MCP_OAUTH_AUDIENCE`, `MCP_OAUTH_DISCOVERY_URL`): exige um JWT do IdP;
 * - `MCP_PUBLIC_URL`: endereço anunciado nos metadados OAuth.
 */
function authFromEnv(): McpTestAuth | undefined {
  const env = process.env;
  if (env.MCP_OAUTH_ISSUER) {
    return {
      kind: 'oauth',
      issuer: env.MCP_OAUTH_ISSUER,
      ...(env.MCP_OAUTH_AUDIENCE && { audience: env.MCP_OAUTH_AUDIENCE }),
      ...(env.MCP_OAUTH_DISCOVERY_URL && { discoveryUrl: env.MCP_OAUTH_DISCOVERY_URL }),
    };
  }
  if (env.MCP_BEARER_TOKEN) return { kind: 'bearer', token: env.MCP_BEARER_TOKEN };
  return undefined;
}

const auth = authFromEnv();
const server = await startMcpTestServer({
  port: Number(process.env.PORT ?? 3333),
  host: process.env.HOST ?? '0.0.0.0',
  mutateSchema: process.env.MUTATE_SCHEMA === '1',
  ...(auth && { auth }),
});
console.log(`Servidor MCP de teste em ${server.url}/mcp (SSE legado em /sse)`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
