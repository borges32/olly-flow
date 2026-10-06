/** Erros do cliente MCP (spec 010). Mensagens em português, sem dados sensíveis. */
export class McpClientError extends Error {
  override name = 'McpClientError';
}

/** O servidor não respondeu no tempo da chamada (NFR-001, FR-006). */
export class McpTimeoutError extends McpClientError {
  override name = 'McpTimeoutError';
  constructor(readonly timeoutMs: number) {
    super(`O servidor MCP não respondeu em ${Math.round(timeoutMs / 1000)} s`);
  }
}

/** Resultado acima de `OLLY_MCP_MAX_RESULT_MB` (FR-006). */
export class McpResultTooLargeError extends McpClientError {
  override name = 'McpResultTooLargeError';
  constructor(readonly limitBytes: number) {
    super(`Resultado do servidor MCP acima do limite de ${formatMb(limitBytes)}`);
  }
}

/** Não foi possível conectar (rede, handshake, anti-SSRF). */
export class McpConnectionError extends McpClientError {
  override name = 'McpConnectionError';
}

/** O servidor exige autenticação e a credencial não serve (ou falta conectar o OAuth). */
export class McpAuthRequiredError extends McpClientError {
  override name = 'McpAuthRequiredError';
}

export function formatMb(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}
