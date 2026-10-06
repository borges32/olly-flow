import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport, FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  ErrorCode,
  McpError,
  ToolListChangedNotificationSchema,
  type CallToolResult,
  type GetPromptResult,
  type Prompt,
  type ReadResourceResult,
  type Resource,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpServerInfo, McpToolDefinition, McpTransport } from '@olly/shared-types';
import {
  McpAuthRequiredError,
  McpClientError,
  McpConnectionError,
  McpResultTooLargeError,
  McpTimeoutError,
} from './errors.js';
import { mcpCallContext } from './fetch.js';

// FR-004 exige o SSE legado; o SDK o marca como obsoleto em favor do Streamable HTTP. Único
// ponto de uso neste pacote (ver report.md da spec 010).
// eslint-disable-next-line @typescript-eslint/no-deprecated -- FR-004: transporte SSE legado
const LegacySseClientTransport = SSEClientTransport;

/** Como conectar num servidor do catálogo. Somente HTTP (FR-004, FR-005). */
export interface McpConnectionConfig {
  serverId: string;
  transport: McpTransport;
  url: string;
  /** Cabeçalhos fixos (credenciais `mcpBearer`/`mcpHeaders`). */
  headers?: Record<string, string>;
  /** OAuth 2.1 conforme a especificação MCP (credencial `mcpOAuth`, FR-007). */
  authProvider?: OAuthClientProvider;
}

export interface McpClientSettings {
  /** `fetch` com o anti-SSRF (ver `guardedFetchLike`). */
  fetch: FetchLike;
  /** `OLLY_MCP_CALL_TIMEOUT_MS` (NFR-001: 60 s). */
  callTimeoutMs: number;
  /** `OLLY_MCP_MAX_RESULT_MB` em bytes (FR-006). */
  maxResultBytes: number;
  clientInfo?: { name: string; version: string };
  /** Tools anunciadas ao conectar e a cada `notifications/tools/list_changed` (FR-003). */
  onToolsListed?: (serverId: string, tools: McpToolDefinition[]) => void | Promise<void>;
}

export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const MAX_PAGES = 50;
const REQUEST_TIMEOUT: number = ErrorCode.RequestTimeout;

/** Uma sessão MCP aberta (reaproveitada pelo `McpConnectionPool`, FR-006). */
export class McpConnection {
  private toolsCache?: Promise<McpToolDefinition[]>;
  private isClosed = false;

  private constructor(
    readonly serverId: string,
    private readonly client: Client,
    readonly serverInfo: McpServerInfo,
    private readonly settings: McpClientSettings,
  ) {}

  static async open(
    config: McpConnectionConfig,
    settings: McpClientSettings,
  ): Promise<McpConnection> {
    const client = new Client(settings.clientInfo ?? { name: 'olly-flow', version: '1.0.0' });
    let transport: Transport;
    try {
      const url = new URL(config.url);
      const options = {
        fetch: settings.fetch,
        ...(config.headers && { requestInit: { headers: config.headers } }),
        ...(config.authProvider && { authProvider: config.authProvider }),
      };
      transport =
        config.transport === 'sse'
          ? new LegacySseClientTransport(url, options)
          : new StreamableHTTPClientTransport(url, options);
    } catch (error) {
      throw new McpConnectionError(`URL do servidor MCP inválida: ${describe(error)}`);
    }
    try {
      await client.connect(transport, { timeout: settings.callTimeoutMs });
    } catch (error) {
      await client.close().catch(() => undefined);
      throw connectionError(error, settings.callTimeoutMs);
    }
    const version = client.getServerVersion();
    const info: McpServerInfo = {
      ...(version?.name && { name: version.name }),
      ...(version?.version && { version: version.version }),
      ...(transport instanceof StreamableHTTPClientTransport &&
        transport.protocolVersion && { protocolVersion: transport.protocolVersion }),
      capabilities: client.getServerCapabilities() ?? {},
      ...(client.getInstructions() && { instructions: client.getInstructions() }),
    };
    const connection = new McpConnection(config.serverId, client, info, settings);
    client.onclose = () => {
      connection.isClosed = true;
    };
    // FR-003: mudanças anunciadas pelo servidor durante a sessão são comparadas na hora.
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      connection.toolsCache = undefined;
      void connection.tools().catch(() => undefined);
    });
    return connection;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  get capabilities(): Record<string, unknown> {
    return this.serverInfo.capabilities;
  }

  /** Tools anunciadas (em cache até o próximo `list_changed`). */
  tools(options: CallOptions = {}): Promise<McpToolDefinition[]> {
    this.toolsCache ??= this.listTools(options).then(
      async (tools) => {
        await this.settings.onToolsListed?.(this.serverId, tools);
        return tools;
      },
      (error: unknown) => {
        this.toolsCache = undefined;
        throw error;
      },
    );
    return this.toolsCache;
  }

  /** `tools/list` seguindo `nextCursor`. */
  async listTools(options: CallOptions = {}): Promise<McpToolDefinition[]> {
    if (!this.capabilities.tools) return [];
    const tools = await this.paginate(async (cursor, opts) => {
      const page = await this.client.listTools(cursor ? { cursor } : {}, this.requestOptions(opts));
      return { items: page.tools, nextCursor: page.nextCursor };
    }, options);
    return tools.map((t) => ({
      name: t.name,
      ...(t.description !== undefined && { description: t.description }),
      inputSchema: t.inputSchema,
      ...(t.annotations && {
        annotations: {
          ...(t.annotations.readOnlyHint !== undefined && {
            readOnlyHint: t.annotations.readOnlyHint,
          }),
          ...(t.annotations.destructiveHint !== undefined && {
            destructiveHint: t.annotations.destructiveHint,
          }),
        },
      }),
    }));
  }

  async listResources(options: CallOptions = {}): Promise<Resource[]> {
    if (!this.capabilities.resources) return [];
    return this.paginate(async (cursor, opts) => {
      const page = await this.client.listResources(
        cursor ? { cursor } : {},
        this.requestOptions(opts),
      );
      return { items: page.resources, nextCursor: page.nextCursor };
    }, options);
  }

  async listPrompts(options: CallOptions = {}): Promise<Prompt[]> {
    if (!this.capabilities.prompts) return [];
    return this.paginate(async (cursor, opts) => {
      const page = await this.client.listPrompts(
        cursor ? { cursor } : {},
        this.requestOptions(opts),
      );
      return { items: page.prompts, nextCursor: page.nextCursor };
    }, options);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: CallOptions = {},
  ): Promise<CallToolResult> {
    return this.guarded(options, async (opts) => {
      const result = await this.client.callTool(
        { name, arguments: args },
        undefined,
        this.requestOptions(opts),
      );
      return this.checkSize(result as CallToolResult);
    });
  }

  async readResource(uri: string, options: CallOptions = {}): Promise<ReadResourceResult> {
    return this.guarded(options, async (opts) =>
      this.checkSize(await this.client.readResource({ uri }, this.requestOptions(opts))),
    );
  }

  async getPrompt(
    name: string,
    args: Record<string, string>,
    options: CallOptions = {},
  ): Promise<GetPromptResult> {
    return this.guarded(options, async (opts) =>
      this.checkSize(
        await this.client.getPrompt({ name, arguments: args }, this.requestOptions(opts)),
      ),
    );
  }

  async close(): Promise<void> {
    this.isClosed = true;
    await this.client.close().catch(() => undefined);
  }

  private requestOptions(options: CallOptions) {
    // No cancelamento (sinal), o SDK envia `notifications/cancelled` ao servidor (FR-006).
    return {
      timeout: options.timeoutMs ?? this.settings.callTimeoutMs,
      ...(options.signal && { signal: options.signal }),
    };
  }

  private async paginate<T>(
    page: (
      cursor: string | undefined,
      options: CallOptions,
    ) => Promise<{ items: T[]; nextCursor?: string }>,
    options: CallOptions,
  ): Promise<T[]> {
    return this.guarded(options, async (opts) => {
      const all: T[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < MAX_PAGES; i++) {
        const result = await page(cursor, opts);
        all.push(...result.items);
        if (!result.nextCursor) return all;
        cursor = result.nextCursor;
      }
      throw new McpClientError(`O servidor MCP devolveu mais de ${MAX_PAGES} páginas`);
    });
  }

  /** Resultados que chegam por outro caminho (SSE legado) também respeitam o limite. */
  private checkSize<T>(result: T): T {
    if (Buffer.byteLength(JSON.stringify(result)) > this.settings.maxResultBytes) {
      throw new McpResultTooLargeError(this.settings.maxResultBytes);
    }
    return result;
  }

  /**
   * Executa a chamada com um sinal próprio, ligado ao do chamador: o limite de tamanho do
   * `fetch` (ver `mcpCallContext`) aborta só esta chamada.
   */
  private async guarded<T>(
    options: CallOptions,
    fn: (options: CallOptions) => Promise<T>,
  ): Promise<T> {
    const internal = new AbortController();
    const forward = () => {
      internal.abort(options.signal?.reason);
    };
    if (options.signal?.aborted) forward();
    options.signal?.addEventListener('abort', forward);
    try {
      return await mcpCallContext.run(
        {
          fail: (error) => {
            internal.abort(error);
          },
        },
        () => fn({ ...options, signal: internal.signal }),
      );
    } catch (error) {
      if (internal.signal.aborted) throw internal.signal.reason;
      throw callError(error, options.timeoutMs ?? this.settings.callTimeoutMs);
    } finally {
      options.signal?.removeEventListener('abort', forward);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function findInChain<T extends Error>(
  error: unknown,
  type: abstract new (...args: never[]) => T,
): T | undefined {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    if (e instanceof type) return e;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

function callError(error: unknown, timeoutMs: number): Error {
  const tooLarge = findInChain(error, McpResultTooLargeError);
  if (tooLarge) return tooLarge;
  if (error instanceof McpClientError) return error;
  if (error instanceof McpError && error.code === REQUEST_TIMEOUT) {
    return new McpTimeoutError(timeoutMs);
  }
  if (findInChain(error, UnauthorizedError)) {
    return new McpAuthRequiredError('O servidor MCP recusou a credencial (autentique de novo)');
  }
  if (error instanceof McpError) return new McpClientError(error.message);
  return new McpConnectionError(`Falha na comunicação com o servidor MCP: ${describe(error)}`);
}

function connectionError(error: unknown, timeoutMs: number): Error {
  const mapped = callError(error, timeoutMs);
  if (mapped instanceof McpTimeoutError || mapped instanceof McpAuthRequiredError) return mapped;
  // O bloqueio do anti-SSRF chega aqui com a mensagem do filtro (SC-005).
  return new McpConnectionError(`Não foi possível conectar ao servidor MCP: ${describe(error)}`);
}
