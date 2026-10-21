import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqlFileMigrationProvider, migrateDown, migrateToLatest } from './index.js';
import { startTestDatabase, type TestDatabase } from './testing.js';

const TABLES = [
  'agent_memory',
  'agent_steps',
  'ai_models',
  'approval_requests',
  'audit_log',
  'credentials',
  'execution_payloads',
  'execution_state',
  'executions',
  'group_role_mappings',
  'llm_pricing',
  'llm_usage',
  'masking_rules',
  'mcp_calls',
  'mcp_servers',
  'mcp_tool_policies',
  'node_executions',
  'olly_chat_config',
  'olly_chat_messages',
  'olly_chat_sessions',
  'project_members',
  'projects',
  'publish_requests',
  'roles',
  'user_sessions',
  'users',
  'webhooks',
  'workflow_versions',
  'workflows',
];

const AI_TABLES = ['agent_memory', 'agent_steps', 'approval_requests', 'llm_pricing', 'llm_usage'];
const BEFORE_0020 = TABLES.filter((n) => !n.startsWith('olly_chat_'));
const BEFORE_0015 = BEFORE_0020.filter((n) => n !== 'user_sessions');
const BEFORE_0013 = BEFORE_0015.filter((n) => n !== 'ai_models');
const BEFORE_0012 = BEFORE_0013.filter((n) => !AI_TABLES.includes(n));

const BEFORE_0011 = BEFORE_0012.filter((n) => n !== 'execution_state');

const BEFORE_0010 = BEFORE_0011.filter((n) => !n.startsWith('mcp_'));

const BEFORE_0009 = BEFORE_0010.filter(
  (n) => !['group_role_mappings', 'masking_rules', 'publish_requests'].includes(n),
);

let t: TestDatabase;

async function publicTables(): Promise<string[]> {
  // Partições mensais (executions_202610...) não contam: só as tabelas-mãe.
  const { rows } = await sql<{ table_name: string }>`
    SELECT c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND c.relname NOT LIKE 'kysely_%'
    ORDER BY c.relname`.execute(t.db);
  return rows.map((r) => r.table_name);
}

beforeAll(async () => {
  t = await startTestDatabase({ migrate: false, seed: false });
});
afterAll(async () => {
  await t.stop();
});

describe('FR-009: migrations versionadas e reversíveis', () => {
  it('FR-009/SC-003: up cria as tabelas da fundação', async () => {
    const applied = await migrateToLatest(t.db);
    expect(applied).toEqual([
      'Up 0001_fundacao',
      'Up 0002_workflows',
      'Up 0003_executions',
      'Up 0004_node_reused',
      'Up 0005_credentials',
      'Up 0006_publish_console',
      'Up 0007_queue',
      'Up 0008_error_workflow',
      'Up 0009_governanca',
      'Up 0010_mcp',
      'Up 0011_execution_state',
      'Up 0012_ai_agent',
      'Up 0013_ai_models',
      'Up 0014_trace_id',
      'Up 0015_local_users',
      'Up 0016_mcp_insecure_tls',
      'Up 0017_postgres14_unique',
      'Up 0018_execution_parent_node',
      'Up 0019_project_stream_limit',
      'Up 0020_olly_chat',
    ]);
    expect(await publicTables()).toEqual(TABLES);
  });

  it('FR-009: up é idempotente quando não há pendências', async () => {
    expect(await migrateToLatest(t.db)).toEqual([]);
  });

  it('FR-009/SC-003: down reverte tudo e up reaplica sem erro', async () => {
    const reverted = await migrateDown(t.db, { all: true });
    expect(reverted).toEqual([
      'Down 0020_olly_chat',
      'Down 0019_project_stream_limit',
      'Down 0018_execution_parent_node',
      'Down 0017_postgres14_unique',
      'Down 0016_mcp_insecure_tls',
      'Down 0015_local_users',
      'Down 0014_trace_id',
      'Down 0013_ai_models',
      'Down 0012_ai_agent',
      'Down 0011_execution_state',
      'Down 0010_mcp',
      'Down 0009_governanca',
      'Down 0008_error_workflow',
      'Down 0007_queue',
      'Down 0006_publish_console',
      'Down 0005_credentials',
      'Down 0004_node_reused',
      'Down 0003_executions',
      'Down 0002_workflows',
      'Down 0001_fundacao',
    ]);
    expect(await publicTables()).toEqual([]);
    const { rows } = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'audit_log_immutable'`.execute(t.db);
    expect(rows[0]?.n).toBe(0);

    await migrateToLatest(t.db);
    expect(await publicTables()).toEqual(TABLES);
  });

  it('spec 010 (Histórico 14/10/2026): down de 0016 remove só mcp_servers.insecure_tls', async () => {
    const column = async () => {
      const { rows } = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'mcp_servers' AND column_name = 'insecure_tls'`.execute(t.db);
      return rows[0]?.n;
    };
    expect(await column()).toBe(1);
    await migrateDown(t.db); // 0020 (spec 028, chat da plataforma)
    await migrateDown(t.db); // 0019 (spec 027, projects.max_webhook_streams)
    await migrateDown(t.db); // 0018 (spec 026, executions.parent_node_id)
    await migrateDown(t.db); // 0017 (compatibilidade com o PostgreSQL 14)
    expect(await migrateDown(t.db)).toEqual(['Down 0016_mcp_insecure_tls']);
    expect(await column()).toBe(0);
    expect(await publicTables()).toEqual(BEFORE_0020);
    await migrateToLatest(t.db);
  });

  it('spec 028: down de 0020 remove só o chat da plataforma (tabelas e colunas de users)', async () => {
    const columns = async () => {
      const { rows } = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'users' AND column_name IN ('idp_username', 'chat_sessions_created')`.execute(
        t.db,
      );
      return rows[0]?.n;
    };
    expect(await columns()).toBe(2);
    expect(await migrateDown(t.db)).toEqual(['Down 0020_olly_chat']);
    expect(await columns()).toBe(0);
    expect(await publicTables()).toEqual(BEFORE_0020);
    await migrateToLatest(t.db);
    expect(await publicTables()).toEqual(TABLES);
  });

  it('spec 027: down de 0019 remove só projects.max_webhook_streams', async () => {
    const column = async () => {
      const { rows } = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'projects' AND column_name = 'max_webhook_streams'`.execute(t.db);
      return rows[0]?.n;
    };
    expect(await column()).toBe(1);
    await migrateDown(t.db); // 0020 (spec 028, chat da plataforma)
    expect(await migrateDown(t.db)).toEqual(['Down 0019_project_stream_limit']);
    expect(await column()).toBe(0);
    expect(await publicTables()).toEqual(BEFORE_0020);
    await migrateToLatest(t.db);
  });

  it('spec 026: down de 0018 remove só executions.parent_node_id', async () => {
    const column = async () => {
      const { rows } = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'executions' AND column_name = 'parent_node_id'`.execute(t.db);
      return rows[0]?.n;
    };
    expect(await column()).toBe(1);
    await migrateDown(t.db); // 0020 (spec 028, chat da plataforma)
    await migrateDown(t.db); // 0019 (spec 027, projects.max_webhook_streams)
    expect(await migrateDown(t.db)).toEqual(['Down 0018_execution_parent_node']);
    expect(await column()).toBe(0);
    expect(await publicTables()).toEqual(BEFORE_0020);
    await migrateToLatest(t.db);
  });

  it('PostgreSQL 14 (15/10/2026): as migrations rodam na versão mínima suportada (14.18)', async () => {
    const { rows } = await sql<{ v: number }>`
      SELECT current_setting('server_version_num')::int AS v`.execute(t.db);
    // Sem OLLY_TEST_POSTGRES_IMAGE, os testes usam a 14.18 (docs/arquitetura/stack.md).
    expect(rows[0]?.v).toBeGreaterThanOrEqual(140018);
    expect(await publicTables()).toEqual(TABLES);
  });

  it('PostgreSQL 14 (15/10/2026): índices parciais mantêm a unicidade global e por projeto (antes NULLS NOT DISTINCT)', async () => {
    const violation = async (query: ReturnType<typeof sql>) =>
      query.execute(t.db).then(
        () => null,
        (e: unknown) => (e as { code?: string }).code ?? 'erro',
      );
    await sql`INSERT INTO roles (name) VALUES ('papel-teste') ON CONFLICT DO NOTHING`.execute(t.db);
    const role = await sql<{ id: number }>`SELECT id FROM roles WHERE name = 'papel-teste'`.execute(
      t.db,
    );
    const roleId = role.rows[0]?.id ?? 0;
    const project = await sql<{ id: string }>`
      INSERT INTO projects (name) VALUES ('Unicidade') RETURNING id`.execute(t.db);
    const projectId = project.rows[0]?.id ?? '';
    const mapping = (projectOrNull: string | null) => sql`
      INSERT INTO group_role_mappings (idp_group, project_id, role_id)
      VALUES ('grupo-x', ${projectOrNull}, ${roleId})`;
    expect(await violation(mapping(null))).toBeNull();
    // Dois globais do mesmo grupo: recusado (como NULLS NOT DISTINCT).
    expect(await violation(mapping(null))).toBe('23505');
    expect(await violation(mapping(projectId))).toBeNull();
    expect(await violation(mapping(projectId))).toBe('23505');

    const server = await sql<{ id: string }>`
      INSERT INTO mcp_servers (name, transport, url) VALUES ('srv', 'streamableHttp', 'http://x')
      RETURNING id`.execute(t.db);
    const serverId = server.rows[0]?.id ?? '';
    expect(
      await violation(sql`INSERT INTO mcp_servers (name, transport, url)
        VALUES ('srv', 'streamableHttp', 'http://y')`),
    ).toBe('23505');
    // Upsert da política global pelo índice parcial (o que o catálogo MCP faz).
    const upsertGlobal = (allowed: boolean) => sql`
      INSERT INTO mcp_tool_policies (server_id, project_id, tool_name, allowed)
      VALUES (${serverId}, NULL, 'soma', ${allowed})
      ON CONFLICT (server_id, tool_name) WHERE project_id IS NULL DO UPDATE SET allowed = EXCLUDED.allowed`;
    await upsertGlobal(false).execute(t.db);
    await upsertGlobal(true).execute(t.db);
    const policies = await sql<{ n: number; allowed: boolean }>`
      SELECT count(*)::int AS n, bool_and(allowed) AS allowed FROM mcp_tool_policies
      WHERE server_id = ${serverId}`.execute(t.db);
    expect(policies.rows[0]).toEqual({ n: 1, allowed: true });

    await sql`DELETE FROM mcp_tool_policies`.execute(t.db);
    await sql`DELETE FROM mcp_servers`.execute(t.db);
    await sql`DELETE FROM group_role_mappings`.execute(t.db);
    await sql`DELETE FROM projects WHERE id = ${projectId}`.execute(t.db);
  });

  it('PostgreSQL 14 (15/10/2026): 0017 troca as restrições únicas antigas pelos índices parciais', async () => {
    await migrateDown(t.db); // 0020 (spec 028, chat da plataforma)
    await migrateDown(t.db); // 0019 (spec 027, projects.max_webhook_streams)
    await migrateDown(t.db); // 0018 (spec 026, executions.parent_node_id)
    expect(await migrateDown(t.db)).toEqual(['Down 0017_postgres14_unique']);
    // Estado de um banco migrado antes da mudança: restrições únicas com os nomes gerados.
    await sql`
      DROP INDEX group_role_mappings_project_uq, group_role_mappings_global_uq,
        mcp_servers_project_name_uq, mcp_servers_global_name_uq,
        mcp_tool_policies_project_uq, mcp_tool_policies_global_uq;
      ALTER TABLE group_role_mappings ADD CONSTRAINT group_role_mappings_idp_group_project_id_key
        UNIQUE (idp_group, project_id);
      ALTER TABLE mcp_servers ADD CONSTRAINT mcp_servers_project_id_name_key UNIQUE (project_id, name);
      ALTER TABLE mcp_tool_policies ADD CONSTRAINT mcp_tool_policies_server_id_project_id_tool_name_key
        UNIQUE (server_id, project_id, tool_name)`.execute(t.db);
    await migrateToLatest(t.db);
    const constraints = await sql<{ conname: string }>`
      SELECT conname FROM pg_constraint WHERE contype = 'u'
        AND conrelid::regclass::text IN ('group_role_mappings', 'mcp_servers', 'mcp_tool_policies')`.execute(
      t.db,
    );
    expect(constraints.rows).toEqual([]);
    const indexes = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes WHERE indexname LIKE '%\_uq' ORDER BY indexname`.execute(
      t.db,
    );
    expect(indexes.rows.map((r) => r.indexname)).toEqual([
      'group_role_mappings_global_uq',
      'group_role_mappings_project_uq',
      'mcp_servers_global_name_uq',
      'mcp_servers_project_name_uq',
      'mcp_tool_policies_global_uq',
      'mcp_tool_policies_project_uq',
    ]);
  });

  it('spec 014: down de 0015 remove só as colunas de usuário local e as sessões', async () => {
    const columns = async () => {
      const { rows } = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'users' AND column_name IN
          ('password_hash', 'must_change_password', 'is_admin', 'failed_logins', 'locked_until')`.execute(
        t.db,
      );
      return rows[0]?.n;
    };
    expect(await columns()).toBe(5);
    await migrateDown(t.db); // 0020 (spec 028, chat da plataforma)
    await migrateDown(t.db); // 0019 (spec 027, projects.max_webhook_streams)
    await migrateDown(t.db); // 0018 (spec 026, executions.parent_node_id)
    await migrateDown(t.db); // 0017 (compatibilidade com o PostgreSQL 14)
    await migrateDown(t.db); // 0016 (spec 010, mcp_servers.insecure_tls)
    expect(await migrateDown(t.db)).toEqual(['Down 0015_local_users']);
    expect(await columns()).toBe(0);
    expect(await publicTables()).toEqual(BEFORE_0015);
    await migrateToLatest(t.db);
  });

  it('spec 012: down de 0014 remove só executions.trace_id', async () => {
    await migrateDown(t.db); // 0020 (spec 028, chat da plataforma)
    await migrateDown(t.db); // 0019 (spec 027, projects.max_webhook_streams)
    await migrateDown(t.db); // 0018 (spec 026, executions.parent_node_id)
    await migrateDown(t.db); // 0017 (compatibilidade com o PostgreSQL 14)
    await migrateDown(t.db); // 0016 (spec 010, mcp_servers.insecure_tls)
    await migrateDown(t.db); // 0015 (spec 014)
    const column = async () => {
      const { rows } = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'executions' AND column_name = 'trace_id'`.execute(t.db);
      return rows[0]?.n;
    };
    expect(await column()).toBe(1);
    expect(await migrateDown(t.db)).toEqual(['Down 0014_trace_id']);
    expect(await column()).toBe(0);
    expect(await publicTables()).toEqual(BEFORE_0015);
    await migrateToLatest(t.db);
  });

  it('spec 011: down de 0013 remove só o cadastro de modelos (começa vazio)', async () => {
    await migrateDown(t.db); // 0020 (spec 028, chat da plataforma)
    await migrateDown(t.db); // 0019 (spec 027, projects.max_webhook_streams)
    await migrateDown(t.db); // 0018 (spec 026, executions.parent_node_id)
    await migrateDown(t.db); // 0017 (compatibilidade com o PostgreSQL 14)
    await migrateDown(t.db); // 0016 (spec 010, mcp_servers.insecure_tls)
    await migrateDown(t.db); // 0015 (spec 014)
    await migrateDown(t.db); // 0014 (spec 012)
    const models = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ai_models`.execute(t.db);
    expect(models.rows[0]?.n).toBe(0);
    expect(await migrateDown(t.db)).toEqual(['Down 0013_ai_models']);
    expect(await publicTables()).toEqual(BEFORE_0013);
    await migrateToLatest(t.db);
  });

  it('spec 011: down de 0012 remove as tabelas do agente e as colunas de projeto', async () => {
    await migrateDown(t.db); // 0020 (spec 028, chat da plataforma)
    await migrateDown(t.db); // 0019 (spec 027, projects.max_webhook_streams)
    await migrateDown(t.db); // 0018 (spec 026, executions.parent_node_id)
    await migrateDown(t.db); // 0017 (compatibilidade com o PostgreSQL 14)
    await migrateDown(t.db); // 0016 (spec 010, mcp_servers.insecure_tls)
    await migrateDown(t.db); // 0015 (spec 014)
    await migrateDown(t.db); // 0014 (spec 012)
    await migrateDown(t.db); // 0013 (spec 011)
    const prices = await sql<{ n: number }>`SELECT count(*)::int AS n FROM llm_pricing`.execute(
      t.db,
    );
    expect(prices.rows[0]?.n).toBeGreaterThan(10);
    expect(await migrateDown(t.db)).toEqual(['Down 0012_ai_agent']);
    const columns = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'projects' AND column_name IN ('allowed_models', 'monthly_token_limit')`.execute(
      t.db,
    );
    expect(columns.rows[0]?.n).toBe(0);
    expect(await publicTables()).toEqual(BEFORE_0012);
    await migrateToLatest(t.db);
  });

  it('spec 008: down de 0011 remove execution_state e as colunas de sub-workflow', async () => {
    await migrateDown(t.db); // 0020 (spec 028, chat da plataforma)
    await migrateDown(t.db); // 0019 (spec 027, projects.max_webhook_streams)
    await migrateDown(t.db); // 0018 (spec 026, executions.parent_node_id)
    await migrateDown(t.db); // 0017 (compatibilidade com o PostgreSQL 14)
    await migrateDown(t.db); // 0016 (spec 010, mcp_servers.insecure_tls)
    await migrateDown(t.db); // 0015 (spec 014)
    await migrateDown(t.db); // 0014 (spec 012)
    await migrateDown(t.db); // 0013 (spec 011)
    await migrateDown(t.db); // 0012 (spec 011)
    const columns = async () => {
      const { rows } = await sql<{ name: string }>`
        SELECT column_name AS name FROM information_schema.columns
        WHERE table_name = 'executions' AND column_name IN ('parent_execution_id', 'depth', 'retry_of')
        ORDER BY 1`.execute(t.db);
      return rows.map((r) => r.name);
    };
    expect(await columns()).toEqual(['depth', 'parent_execution_id', 'retry_of']);
    expect(await migrateDown(t.db)).toEqual(['Down 0011_execution_state']);
    expect(await columns()).toEqual([]);
    expect(await publicTables()).toEqual(BEFORE_0011);
    await migrateToLatest(t.db);
  });

  it('spec 010: down de 0010 remove só as tabelas do MCP', async () => {
    await migrateDown(t.db); // 0020 (spec 028, chat da plataforma)
    await migrateDown(t.db); // 0019 (spec 027, projects.max_webhook_streams)
    await migrateDown(t.db); // 0018 (spec 026, executions.parent_node_id)
    await migrateDown(t.db); // 0017 (compatibilidade com o PostgreSQL 14)
    await migrateDown(t.db); // 0016 (spec 010, mcp_servers.insecure_tls)
    await migrateDown(t.db); // 0015 (spec 014)
    await migrateDown(t.db); // 0014 (spec 012)
    await migrateDown(t.db); // 0013 (spec 011)
    await migrateDown(t.db); // 0012 (spec 011)
    await migrateDown(t.db); // 0011 (spec 008)
    const transports = await sql<{ def: string }>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'mcp_servers'::regclass AND contype = 'c'`.execute(t.db);
    // FR-005: o banco também só aceita transportes HTTP.
    expect(transports.rows.map((r) => r.def).join(' ')).not.toContain('stdio');
    expect(await migrateDown(t.db)).toEqual(['Down 0010_mcp']);
    expect(await publicTables()).toEqual(BEFORE_0010);
    await migrateToLatest(t.db);
    expect(await publicTables()).toEqual(TABLES);
  });

  it('spec 009: down de 0009 remove só as tabelas e colunas de governança', async () => {
    const columns = async () => {
      const { rows } = await sql<{ name: string }>`
        SELECT table_name || '.' || column_name AS name FROM information_schema.columns
        WHERE (table_name, column_name) IN (('users', 'last_login_at'), ('project_members', 'origin'),
          ('projects', 'require_publish_approval'), ('projects', 'executor_can_read_data'),
          ('projects', 'save_execution_data'), ('projects', 'retention'),
          ('node_executions', 'data_masked'), ('credentials', 'key_provider'))
        ORDER BY 1`.execute(t.db);
      return rows.map((r) => r.name);
    };
    expect(await columns()).toHaveLength(8);
    const rules = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM masking_rules WHERE builtin`.execute(t.db);
    expect(rules.rows[0]?.n).toBe(14);
    await migrateDown(t.db); // 0020 (spec 028, chat da plataforma)
    await migrateDown(t.db); // 0019 (spec 027, projects.max_webhook_streams)
    await migrateDown(t.db); // 0018 (spec 026, executions.parent_node_id)
    await migrateDown(t.db); // 0017 (compatibilidade com o PostgreSQL 14)
    await migrateDown(t.db); // 0016 (spec 010, mcp_servers.insecure_tls)
    await migrateDown(t.db); // 0015 (spec 014)
    await migrateDown(t.db); // 0014 (spec 012)
    await migrateDown(t.db); // 0013 (spec 011)
    await migrateDown(t.db); // 0012 (spec 011)
    await migrateDown(t.db); // 0011 (spec 008)
    await migrateDown(t.db); // 0010 (spec 010)
    expect(await migrateDown(t.db)).toEqual(['Down 0009_governanca']);
    expect(await columns()).toEqual([]);
    expect(await publicTables()).toEqual(BEFORE_0009);
    await migrateToLatest(t.db);
  });

  it('FR-014 (spec 007): down de 0008 remove só a coluna error_workflow_id', async () => {
    await migrateDown(t.db); // 0020 (spec 028, chat da plataforma)
    await migrateDown(t.db); // 0019 (spec 027, projects.max_webhook_streams)
    await migrateDown(t.db); // 0018 (spec 026, executions.parent_node_id)
    await migrateDown(t.db); // 0017 (compatibilidade com o PostgreSQL 14)
    await migrateDown(t.db); // 0016 (spec 010, mcp_servers.insecure_tls)
    await migrateDown(t.db); // 0015 (spec 014)
    await migrateDown(t.db); // 0014 (spec 012)
    await migrateDown(t.db); // 0013 (spec 011)
    await migrateDown(t.db); // 0012 (spec 011)
    await migrateDown(t.db); // 0011 (spec 008)
    await migrateDown(t.db); // 0010 (spec 010)
    await migrateDown(t.db); // 0009 (spec 009)
    const column = async () => {
      const { rows } = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'workflows' AND column_name = 'error_workflow_id'`.execute(t.db);
      return rows[0]?.n;
    };
    expect(await column()).toBe(1);
    expect(await migrateDown(t.db)).toEqual(['Down 0008_error_workflow']);
    expect(await column()).toBe(0);
    expect(await publicTables()).toEqual(BEFORE_0009);
    await migrateToLatest(t.db);
  });

  it('FR-001/FR-005/FR-012 (spec 006): down de 0007 remove só a tabela de payloads, o batimento e a cota', async () => {
    await migrateDown(t.db); // 0020 (spec 028, chat da plataforma)
    await migrateDown(t.db); // 0019 (spec 027, projects.max_webhook_streams)
    await migrateDown(t.db); // 0018 (spec 026, executions.parent_node_id)
    await migrateDown(t.db); // 0017 (compatibilidade com o PostgreSQL 14)
    await migrateDown(t.db); // 0016 (spec 010, mcp_servers.insecure_tls)
    await migrateDown(t.db); // 0015 (spec 014)
    await migrateDown(t.db); // 0014 (spec 012)
    await migrateDown(t.db); // 0013 (spec 011)
    await migrateDown(t.db); // 0012 (spec 011)
    await migrateDown(t.db); // 0011 (spec 008)
    await migrateDown(t.db); // 0010 (spec 010)
    await migrateDown(t.db); // 0009 (spec 009)
    const columns = async () => {
      const { rows } = await sql<{ name: string }>`
        SELECT table_name || '.' || column_name AS name FROM information_schema.columns
        WHERE (table_name, column_name) IN (('executions', 'heartbeat_at'),
          ('projects', 'max_concurrent_executions'))
        ORDER BY 1`.execute(t.db);
      return rows.map((r) => r.name);
    };
    expect(await columns()).toEqual([
      'executions.heartbeat_at',
      'projects.max_concurrent_executions',
    ]);
    await migrateDown(t.db);
    expect(await migrateDown(t.db)).toEqual(['Down 0007_queue']);
    expect(await columns()).toEqual([]);
    expect(await publicTables()).toEqual(BEFORE_0009.filter((n) => n !== 'execution_payloads'));
    await migrateToLatest(t.db);
  });

  it('FR-001/FR-012 (spec 005): down de 0006 remove só as colunas de publicação e console', async () => {
    await migrateDown(t.db); // 0020 (spec 028, chat da plataforma)
    await migrateDown(t.db); // 0019 (spec 027, projects.max_webhook_streams)
    await migrateDown(t.db); // 0018 (spec 026, executions.parent_node_id)
    await migrateDown(t.db); // 0017 (compatibilidade com o PostgreSQL 14)
    await migrateDown(t.db); // 0016 (spec 010, mcp_servers.insecure_tls)
    await migrateDown(t.db); // 0015 (spec 014)
    await migrateDown(t.db); // 0014 (spec 012)
    await migrateDown(t.db); // 0013 (spec 011)
    await migrateDown(t.db); // 0012 (spec 011)
    await migrateDown(t.db); // 0011 (spec 008)
    await migrateDown(t.db); // 0010 (spec 010)
    await migrateDown(t.db); // 0009 (spec 009)
    const columns = async () => {
      const { rows } = await sql<{ name: string }>`
        SELECT table_name || '.' || column_name AS name FROM information_schema.columns
        WHERE (table_name, column_name) IN (('workflows', 'published_version'), ('workflows', 'active'),
          ('executions', 'definition'), ('node_executions', 'console'))
        ORDER BY 1`.execute(t.db);
      return rows.map((r) => r.name);
    };
    expect(await columns()).toEqual([
      'executions.definition',
      'node_executions.console',
      'workflows.active',
      'workflows.published_version',
    ]);
    await migrateDown(t.db);
    await migrateDown(t.db);
    expect(await migrateDown(t.db)).toEqual(['Down 0006_publish_console']);
    expect(await columns()).toEqual([]);
    expect(await publicTables()).toEqual(BEFORE_0009.filter((n) => n !== 'execution_payloads'));
    await migrateToLatest(t.db);
  });

  it('FR-001 (spec 004): down de 0005 remove só a tabela credentials', async () => {
    await migrateDown(t.db); // 0020 (spec 028, chat da plataforma)
    await migrateDown(t.db); // 0019 (spec 027, projects.max_webhook_streams)
    await migrateDown(t.db); // 0018 (spec 026, executions.parent_node_id)
    await migrateDown(t.db); // 0017 (compatibilidade com o PostgreSQL 14)
    await migrateDown(t.db); // 0016 (spec 010, mcp_servers.insecure_tls)
    await migrateDown(t.db); // 0015 (spec 014)
    await migrateDown(t.db); // 0014 (spec 012)
    await migrateDown(t.db); // 0013 (spec 011)
    await migrateDown(t.db); // 0012 (spec 011)
    await migrateDown(t.db); // 0011 (spec 008)
    await migrateDown(t.db); // 0010 (spec 010)
    await migrateDown(t.db); // 0009 (spec 009)
    await migrateDown(t.db);
    await migrateDown(t.db);
    await migrateDown(t.db);
    expect(await migrateDown(t.db)).toEqual(['Down 0005_credentials']);
    expect(await publicTables()).toEqual(
      BEFORE_0009.filter((n) => n !== 'credentials' && n !== 'execution_payloads'),
    );
    await migrateToLatest(t.db);
  });

  it('FR-020 (spec 003): down de 0004 remove só a coluna reused', async () => {
    await migrateDown(t.db); // 0020 (spec 028, chat da plataforma)
    await migrateDown(t.db); // 0019 (spec 027, projects.max_webhook_streams)
    await migrateDown(t.db); // 0018 (spec 026, executions.parent_node_id)
    await migrateDown(t.db); // 0017 (compatibilidade com o PostgreSQL 14)
    await migrateDown(t.db); // 0016 (spec 010, mcp_servers.insecure_tls)
    await migrateDown(t.db); // 0015 (spec 014)
    await migrateDown(t.db); // 0014 (spec 012)
    await migrateDown(t.db); // 0013 (spec 011)
    await migrateDown(t.db); // 0012 (spec 011)
    await migrateDown(t.db); // 0011 (spec 008)
    await migrateDown(t.db); // 0010 (spec 010)
    await migrateDown(t.db); // 0009 (spec 009)
    await migrateDown(t.db);
    await migrateDown(t.db);
    await migrateDown(t.db);
    await migrateDown(t.db);
    const reusedColumns = async () => {
      const { rows } = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'node_executions' AND column_name = 'reused'`.execute(t.db);
      return rows[0]?.n;
    };
    expect(await reusedColumns()).toBe(1);
    expect(await migrateDown(t.db)).toEqual(['Down 0004_node_reused']);
    expect(await reusedColumns()).toBe(0);
    expect(await publicTables()).toEqual(
      BEFORE_0009.filter((n) => n !== 'credentials' && n !== 'execution_payloads'),
    );
    await migrateToLatest(t.db);
  });

  it('FR-001/FR-002 (spec 002): down de 0003 e 0002 remove só as tabelas delas', async () => {
    await migrateDown(t.db); // 0020 (spec 028, chat da plataforma)
    await migrateDown(t.db); // 0019 (spec 027, projects.max_webhook_streams)
    await migrateDown(t.db); // 0018 (spec 026, executions.parent_node_id)
    await migrateDown(t.db); // 0017 (compatibilidade com o PostgreSQL 14)
    await migrateDown(t.db); // 0016 (spec 010, mcp_servers.insecure_tls)
    await migrateDown(t.db); // 0015 (spec 014)
    await migrateDown(t.db); // 0014 (spec 012)
    await migrateDown(t.db); // 0013 (spec 011)
    await migrateDown(t.db); // 0012 (spec 011)
    await migrateDown(t.db); // 0011 (spec 008)
    await migrateDown(t.db); // 0010 (spec 010)
    await migrateDown(t.db); // 0009 (spec 009)
    const base = BEFORE_0009.filter((n) => n !== 'credentials' && n !== 'execution_payloads');
    await migrateDown(t.db);
    await migrateDown(t.db);
    await migrateDown(t.db);
    await migrateDown(t.db);
    await migrateDown(t.db);
    await migrateDown(t.db);
    expect(await publicTables()).toEqual(base.filter((n) => !n.includes('executions')));
    await migrateDown(t.db);
    expect(await publicTables()).toEqual(
      base.filter((n) => !n.includes('executions') && !n.startsWith('w')),
    );
    await migrateToLatest(t.db);
  });

  it('FR-009: recusa migration sem arquivo down', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'olly-mig-'));
    await writeFile(join(dir, '0001_x.up.sql'), 'SELECT 1;');
    await expect(new SqlFileMigrationProvider(dir).getMigrations()).rejects.toThrow(/reversível/);
  });
});
