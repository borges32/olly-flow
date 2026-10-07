import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { validateWorkflow } from '@olly/engine';
import { createNodeRegistry } from '@olly/nodes';
import { fromWorkflowFile } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { convertN8n } from './convert.js';

const registry = createNodeRegistry();
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../../fixtures/n8n/${name}/workflow.json`, import.meta.url),
      'utf8',
    ),
  ) as unknown;

/** Converte e importa como a API faz, devolvendo a definição e os erros da validação. */
function importN8n(input: unknown) {
  const { file, report, errors } = convertN8n(input);
  const result = fromWorkflowFile(file, {
    catalog: { get: (t) => registry.get(t) },
    newId: randomUUID,
    allowN8nTypes: true,
  });
  const validation = validateWorkflow(result.definition, registry);
  const byName = (name: string) => result.definition.nodes.find((n) => n.name === name);
  const edge = (from: string, to: string) => {
    const f = byName(from);
    const t = byName(to);
    return result.definition.edges.find((e) => e.from === f?.id && e.to === t?.id);
  };
  return { file, report, errors, result, validation, byName, edge };
}

const node = (
  name: string,
  type: string,
  parameters: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) => ({
  id: randomUUID(),
  name,
  type,
  typeVersion: 1,
  position: [0, 0],
  parameters,
  ...extra,
});
const main = (to: string, index = 0) => ({ node: to, type: 'main', index });

describe('spec 015 — FR-023: conversão dos nós e das conexões do N8N', () => {
  it('fixture Set + If: tipos, parâmetros e conexões convertidos, sem erros', () => {
    const { result, validation, byName, report } = importN8n(fixture('exemplo-set-if'));
    expect(result.issues.errors).toEqual([]);
    expect(validation.errors).toEqual([]);
    expect(byName('Definir campos')).toMatchObject({
      type: 'data.set',
      params: {
        includeOtherFields: true,
        fields: [
          {
            name: 'nomeCompleto',
            type: 'string',
            value: '={{ $json.nome }} {{ $json.sobrenome }}',
          },
          { name: 'maiorDeIdade', type: 'boolean', value: '={{ $json.idade >= 18 }}' },
        ],
      },
    });
    expect(byName('Maior de idade?')?.params).toMatchObject({
      conditions: {
        combinator: 'and',
        conditions: [
          {
            leftValue: '={{ $json.maiorDeIdade }}',
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
      },
    });
    expect(report.nodes.converted.map((c) => c.to)).toEqual([
      'trigger.manual',
      'data.set',
      'logic.if',
    ]);
  });

  it('fixture Webhook + Código: webhook com resposta do último nó e código JavaScript', () => {
    const { result, validation, byName } = importN8n(fixture('exemplo-webhook-code'));
    expect([...result.issues.errors, ...validation.errors]).toEqual([]);
    expect(byName('Webhook')?.params).toMatchObject({
      httpMethod: 'POST',
      path: 'pedidos',
      responseMode: 'lastNode',
    });
    expect(byName('Calcular')).toMatchObject({
      type: 'code.javascript',
      params: { mode: 'runOnceForAllItems' },
    });
  });

  it('If (saídas 0/1), Merge (entradas), Loop Over Items (retorno vai para "continuar") e erro', () => {
    const { result, validation, edge } = importN8n({
      name: 'Laço',
      nodes: [
        node('Início', 'n8n-nodes-base.manualTrigger'),
        node(
          'Se',
          'n8n-nodes-base.if',
          { conditions: { conditions: [], combinator: 'and' } },
          { typeVersion: 2 },
        ),
        node('A', 'n8n-nodes-base.noOp'),
        node('B', 'n8n-nodes-base.noOp'),
        node('Juntar', 'n8n-nodes-base.merge', { mode: 'append' }, { typeVersion: 3 }),
        node('Loop', 'n8n-nodes-base.splitInBatches', { batchSize: 5 }, { typeVersion: 3 }),
        node(
          'HTTP',
          'n8n-nodes-base.httpRequest',
          { url: 'https://api.exemplo.gov.br' },
          { typeVersion: 4.2, onError: 'continueErrorOutput' },
        ),
        node('Falha', 'n8n-nodes-base.noOp'),
        node('Fim', 'n8n-nodes-base.noOp'),
      ],
      connections: {
        Início: { main: [[main('Se')]] },
        Se: { main: [[main('A')], [main('B')]] },
        A: { main: [[main('Juntar', 0)]] },
        B: { main: [[main('Juntar', 1)]] },
        Juntar: { main: [[main('Loop')]] },
        Loop: { main: [[main('Fim')], [main('HTTP')]] },
        HTTP: { main: [[main('Loop')], [main('Falha')]] },
      },
    });
    expect([...result.issues.errors, ...validation.errors]).toEqual([]);
    expect(edge('Se', 'B')).toMatchObject({ fromPort: 'false', toPort: 'main' });
    expect(edge('B', 'Juntar')).toMatchObject({ toPort: 'input2' });
    expect(edge('Loop', 'HTTP')).toMatchObject({ fromPort: 'loop' });
    expect(edge('Loop', 'Fim')).toMatchObject({ fromPort: 'done' });
    expect(edge('HTTP', 'Loop')).toMatchObject({ toPort: 'continue' });
    expect(edge('HTTP', 'Falha')).toMatchObject({ fromPort: 'error' });
  });

  it('HTTP Request v4: autenticação, query, cabeçalhos, corpo em pares e opções', () => {
    const { byName, report } = importN8n({
      nodes: [
        node(
          'HTTP',
          'n8n-nodes-base.httpRequest',
          {
            method: 'POST',
            url: '=https://api.exemplo.gov.br/{{ $json.id }}',
            authentication: 'genericCredentialType',
            genericAuthType: 'httpHeaderAuth',
            sendQuery: true,
            queryParameters: { parameters: [{ name: 'status', value: 'novo' }] },
            sendHeaders: true,
            headerParameters: { parameters: [{ name: 'Accept', value: 'application/json' }] },
            sendBody: true,
            contentType: 'json',
            bodyParameters: {
              parameters: [
                { name: 'nome', value: '={{ $json.nome }}' },
                { name: 'fixo', value: 'x' },
              ],
            },
            options: {
              timeout: 5000,
              response: { response: { neverError: true, responseFormat: 'json' } },
            },
          },
          { typeVersion: 4.2, credentials: { httpHeaderAuth: { id: '1', name: 'Chave da API' } } },
        ),
      ],
      connections: {},
    });
    expect(byName('HTTP')?.params).toMatchObject({
      method: 'POST',
      url: '=https://api.exemplo.gov.br/{{ $json.id }}',
      authentication: 'credential',
      queryParameters: [{ name: 'status', value: 'novo' }],
      headers: [{ name: 'Accept', value: 'application/json' }],
      sendBody: true,
      contentType: 'json',
      jsonBody: '={{ ({ "nome": ($json.nome), "fixo": "x" }) }}',
      options: { timeout: 5000, neverError: true, responseFormat: 'json' },
    });
    expect(report.credentialsToCreate).toEqual([
      {
        name: 'Chave da API',
        n8nType: 'httpHeaderAuth',
        ollyType: 'httpHeaderAuth',
        nodes: ['HTTP'],
      },
    ]);
  });

  it('PostgreSQL: consulta com parâmetros e gravação com colunas definidas', () => {
    const { byName } = importN8n({
      nodes: [
        node(
          'Consulta',
          'n8n-nodes-base.postgres',
          {
            operation: 'executeQuery',
            query: 'select * from t where id = $1',
            options: { queryReplacement: '={{ $json.id }}' },
          },
          { typeVersion: 2.5 },
        ),
        node(
          'Gravar',
          'n8n-nodes-base.postgres',
          {
            operation: 'upsert',
            schema: { __rl: true, value: 'public', mode: 'list' },
            table: { __rl: true, value: 'pedidos', mode: 'list' },
            columns: {
              mappingMode: 'defineBelow',
              value: { id: '={{ $json.id }}' },
              matchingColumns: ['id'],
            },
          },
          { typeVersion: 2.5 },
        ),
      ],
      connections: {},
    });
    expect(byName('Consulta')?.params).toMatchObject({
      query: 'select * from t where id = $1',
      queryParameters: [{ value: '={{ $json.id }}' }],
      mode: 'perItem',
    });
    expect(byName('Gravar')?.params).toMatchObject({
      operation: 'upsert',
      schema: 'public',
      table: 'pedidos',
      columns: { mappingMode: 'defineBelow', values: [{ column: 'id', value: '={{ $json.id }}' }] },
      matchingColumns: [{ column: 'id' }],
    });
  });

  it('Agent com modelo, memória e ferramentas; o output parser é descartado com nota', () => {
    const { result, validation, byName, edge, report } = importN8n({
      nodes: [
        node('Chat', 'n8n-nodes-base.manualTrigger'),
        node(
          'Agente',
          '@n8n/n8n-nodes-langchain.agent',
          {
            promptType: 'define',
            text: '={{ $json.pergunta }}',
            options: { systemMessage: 'Seja breve' },
          },
          { typeVersion: 1.7 },
        ),
        node(
          'OpenAI',
          '@n8n/n8n-nodes-langchain.lmChatOpenAi',
          { model: { __rl: true, value: 'gpt-4o-mini' }, options: { temperature: 0.2 } },
          { typeVersion: 1.2, credentials: { openAiApi: { id: '7', name: 'OpenAI' } } },
        ),
        node(
          'Memória',
          '@n8n/n8n-nodes-langchain.memoryBufferWindow',
          { contextWindowLength: 8 },
          { typeVersion: 1.3 },
        ),
        node(
          'CEP',
          '@n8n/n8n-nodes-langchain.toolHttpRequest',
          {
            toolDescription: 'Consulta um CEP',
            url: 'https://viacep.com.br/ws/{cep}/json/',
            placeholderDefinitions: {
              values: [{ name: 'cep', description: 'CEP com 8 dígitos', type: 'string' }],
            },
          },
          { typeVersion: 1.1 },
        ),
        node('MCP', '@n8n/n8n-nodes-langchain.mcpClientTool', {
          endpointUrl: 'http://mcp:3000/mcp',
          include: 'selected',
          includeTools: ['soma'],
        }),
        node('Parser', '@n8n/n8n-nodes-langchain.outputParserStructured'),
      ],
      connections: {
        Chat: { main: [[main('Agente')]] },
        OpenAI: { ai_languageModel: [[{ node: 'Agente', type: 'ai_languageModel', index: 0 }]] },
        Memória: { ai_memory: [[{ node: 'Agente', type: 'ai_memory', index: 0 }]] },
        CEP: { ai_tool: [[{ node: 'Agente', type: 'ai_tool', index: 0 }]] },
        MCP: { ai_tool: [[{ node: 'Agente', type: 'ai_tool', index: 0 }]] },
        Parser: { ai_outputParser: [[{ node: 'Agente', type: 'ai_outputParser', index: 0 }]] },
      },
    });
    expect([...result.issues.errors, ...validation.errors]).toEqual([]);
    expect(byName('Agente')?.params).toMatchObject({
      promptSource: 'define',
      text: '={{ $json.pergunta }}',
      systemMessage: 'Seja breve',
    });
    expect(byName('OpenAI')?.params).toMatchObject({ model: 'gpt-4o-mini', temperature: 0.2 });
    expect(byName('Memória')?.params).toMatchObject({
      sessionKey: '={{ $json.sessionId }}',
      contextWindowLength: 8,
    });
    expect(byName('CEP')?.params).toMatchObject({
      toolDescription: 'Consulta um CEP',
      url: `=https://viacep.com.br/ws/{{ $fromAI("cep", "CEP com 8 dígitos", "string") }}/json/`,
    });
    expect(byName('MCP')?.params).toMatchObject({
      serverId: '',
      tools: 'selected',
      toolNames: [{ name: 'soma' }],
    });
    expect(edge('OpenAI', 'Agente')).toMatchObject({
      fromPort: 'ai_languageModel',
      toPort: 'ai_languageModel',
    });
    expect(byName('Parser')).toMatchObject({ type: 'placeholder.unsupported', disabled: true });
    expect(report.semanticNotes.join(' ')).toContain('ai_outputParser');
  });
});

describe('spec 015 — FR-016/FR-026: nós sem conversão e relatório de migração', () => {
  it('tipos sem conversão (ou versão não mapeada) viram marcadores com o JSON original e as portas', () => {
    const { result, validation, byName, edge, report } = importN8n({
      nodes: [
        node(
          'Agendado',
          'n8n-nodes-base.scheduleTrigger',
          { rule: { interval: [{}] } },
          { typeVersion: 1.2 },
        ),
        node(
          'Slack',
          'n8n-nodes-base.slack',
          { channel: '#geral' },
          { typeVersion: 2.2, credentials: { slackApi: { id: '3', name: 'Slack' } } },
        ),
        node('Antigo', 'n8n-nodes-base.httpRequest', { url: 'x' }, { typeVersion: 3 }),
        node(
          'Python',
          'n8n-nodes-base.code',
          { language: 'python', pythonCode: 'return items' },
          { typeVersion: 2 },
        ),
        node('Nota', 'n8n-nodes-base.stickyNote', { content: 'oi' }),
      ],
      connections: {
        Agendado: { main: [[main('Slack')]] },
        Slack: { main: [[main('Antigo')]] },
        Antigo: { main: [[main('Python')]] },
      },
    });
    expect([...result.issues.errors, ...validation.errors]).toEqual([]);
    expect(byName('Nota')).toBeUndefined();
    expect(byName('Agendado')).toMatchObject({
      type: 'placeholder.unsupported',
      disabled: true,
      params: {
        originalType: 'n8n-nodes-base.scheduleTrigger',
        ports: { inputs: [], outputs: ['main'] },
      },
    });
    expect(JSON.parse(String(byName('Slack')?.params.originalJson))).toMatchObject({
      parameters: { channel: '#geral' },
    });
    expect(String(byName('Slack')?.params.originalJson)).not.toContain('slackApi');
    expect(byName('Antigo')?.params.reason).toContain('versão 3');
    expect(byName('Python')?.params.reason).toContain('Python');
    expect(edge('Agendado', 'Slack')).toMatchObject({ fromPort: 'out0', toPort: 'in0' });
    expect(report.nodes.unsupported.map((u) => u.node)).toEqual([
      'Agendado',
      'Slack',
      'Antigo',
      'Python',
    ]);
    expect(report.credentialsToCreate).toEqual([
      { name: 'Slack', n8nType: 'slackApi', nodes: ['Slack'] },
    ]);
    expect(report.semanticNotes.join(' ')).toContain('sticky notes');
    expect(result.issues.pending.filter((p) => p.code === 'UNSUPPORTED_NODE')).toHaveLength(4);
  });

  it('FR-024: expressões com construções do N8N que o Olly Flow não tem são marcadas para revisão', () => {
    const { report } = importN8n({
      nodes: [
        node(
          'Definir',
          'n8n-nodes-base.set',
          {
            assignments: {
              assignments: [
                { name: 'a', type: 'number', value: '={{ $json.n.toInt() }}' },
                { name: 'b', type: 'string', value: '={{ $items("X")[0].json.y }}' },
                { name: 'c', type: 'string', value: '={{ $vars.x }}' },
                { name: 'd', type: 'string', value: '={{ $json.ok }}' },
              ],
            },
          },
          { typeVersion: 3.4 },
        ),
      ],
      connections: {},
    });
    const review = report.expressionsToReview;
    expect(review.map((r) => `${r.node}|${r.parameter}`)).toEqual([
      'Definir|fields[0].value',
      'Definir|fields[1].value',
      'Definir|fields[2].value',
    ]);
    expect(review[0]?.reason).toContain('toInt');
    expect(review[1]?.reason).toBe('$items não existe no Olly Flow');
    expect(review[2]?.reason).toContain('$vars');
  });

  it('FR-025: credenciais não são importadas: o arquivo só cita o tipo do Olly Flow e o nome', () => {
    const { file } = importN8n({
      nodes: [
        node(
          'PG',
          'n8n-nodes-base.postgres',
          { operation: 'executeQuery', query: 'select 1' },
          { typeVersion: 2.5, credentials: { postgres: { id: '99', name: 'Banco' } } },
        ),
      ],
      connections: {},
    });
    expect(file.nodes[0]?.credentials).toEqual({ postgres: { name: 'Banco' } });
  });

  it('arquivo do Olly Flow no formato N8N e conteúdo inválido são recusados', () => {
    expect(
      convertN8n({ nodes: [{ name: 'A', type: 'data.set' }], connections: {} }).errors[0]?.code,
    ).toBe('OLLY_FILE');
    expect(convertN8n({ x: 1 }).errors[0]?.code).toBe('IMPORT_INVALID');
    expect(convertN8n({ nodes: [], connections: {} }).errors).toEqual([]);
  });
});
