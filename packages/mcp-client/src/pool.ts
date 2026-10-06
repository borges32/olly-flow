import { McpConnection, type McpClientSettings, type McpConnectionConfig } from './connection.js';
import { McpAuthRequiredError, McpConnectionError } from './errors.js';

export interface McpPoolOptions extends McpClientSettings {
  /** Conexão ociosa por mais que isto é fechada (plan §3: 5 min). */
  idleTimeoutMs?: number;
}

interface Entry {
  connection?: McpConnection;
  connecting?: Promise<McpConnection>;
  inFlight: number;
  lastUsed: number;
}

const DEFAULT_IDLE_MS = 5 * 60_000;

/**
 * Conexões MCP reaproveitadas (FR-006): uma por chave (servidor + versão da configuração e da
 * credencial), fechadas depois de ociosas. Uma conexão que cai ou perde a autenticação sai do
 * pool, e a próxima chamada reconecta (com novo `initialize`).
 */
export class McpConnectionPool {
  private readonly entries = new Map<string, Entry>();
  private readonly sweeper: NodeJS.Timeout;
  private readonly idleMs: number;

  constructor(private readonly options: McpPoolOptions) {
    this.idleMs = options.idleTimeoutMs ?? DEFAULT_IDLE_MS;
    this.sweeper = setInterval(() => void this.sweep(), Math.min(this.idleMs / 2, 30_000));
    this.sweeper.unref();
  }

  get size(): number {
    return this.entries.size;
  }

  /** Executa `fn` com a conexão da chave, abrindo-a se preciso. */
  async use<T>(
    key: string,
    config: McpConnectionConfig,
    fn: (connection: McpConnection) => Promise<T>,
  ): Promise<T> {
    let entry = this.entries.get(key);
    if (entry?.connection?.closed) {
      this.entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      entry = { inFlight: 0, lastUsed: Date.now() };
      this.entries.set(key, entry);
    }
    entry.inFlight++;
    entry.lastUsed = Date.now();
    try {
      const connection = await this.connect(key, entry, config);
      return await fn(connection);
    } catch (error) {
      // Conexão inutilizável: a próxima chamada abre outra.
      if (error instanceof McpConnectionError || error instanceof McpAuthRequiredError) {
        await this.drop(key);
      }
      throw error;
    } finally {
      entry.inFlight--;
      entry.lastUsed = Date.now();
    }
  }

  /** Fecha e remove a conexão (ex.: servidor alterado ou desativado). */
  async drop(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    await entry.connection?.close();
  }

  /** Fecha as conexões cuja chave começa com o prefixo (ex.: todas de um servidor). */
  async dropPrefix(prefix: string): Promise<void> {
    await Promise.all(
      [...this.entries.keys()].filter((k) => k.startsWith(prefix)).map((k) => this.drop(k)),
    );
  }

  async closeAll(): Promise<void> {
    clearInterval(this.sweeper);
    await Promise.all([...this.entries.keys()].map((k) => this.drop(k)));
  }

  private async connect(
    key: string,
    entry: Entry,
    config: McpConnectionConfig,
  ): Promise<McpConnection> {
    if (entry.connection && !entry.connection.closed) return entry.connection;
    entry.connecting ??= McpConnection.open(config, this.options).then(
      async (connection) => {
        entry.connection = connection;
        entry.connecting = undefined;
        // Plan §2: a cada conexão nova, as tools anunciadas são comparadas com o snapshot.
        await connection.tools().catch(() => undefined);
        return connection;
      },
      (error: unknown) => {
        entry.connecting = undefined;
        if (this.entries.get(key) === entry) this.entries.delete(key);
        throw error;
      },
    );
    return entry.connecting;
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.inFlight === 0 && now - entry.lastUsed > this.idleMs) await this.drop(key);
    }
  }
}
