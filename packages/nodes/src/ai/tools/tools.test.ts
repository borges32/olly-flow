import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { builtinNodes } from '../../builtin.js';
import type { JSONSchema7 } from '../../types.js';
import { fromAISchema } from '../runtime/from-ai.js';
import { CODE_TOOL_EXAMPLES, HTTP_TOOL_EXAMPLES } from './definitions.js';

const httpTool = builtinNodes.find((n) => n.type === 'tool.httpRequest');
const prop = (name: string) =>
  (httpTool?.paramsSchema.properties as Record<string, JSONSchema7>)[name];

describe('spec 011 — FR-007: exemplos de $fromAI na Ferramenta: HTTP', () => {
  it('mostra os exemplos da URL abaixo dos parâmetros de query e o do corpo abaixo do JSON', () => {
    expect(prop('queryParameters')?.description).toContain(HTTP_TOOL_EXAMPLES.url);
    expect(prop('queryParameters')?.description).toContain(HTTP_TOOL_EXAMPLES.queryValue);
    expect(prop('jsonBody')?.description).toContain(HTTP_TOOL_EXAMPLES.jsonBody);
    // O nó HTTP comum continua sem os exemplos.
    const http = builtinNodes.find((n) => n.type === 'http.request');
    const httpBody = (http?.paramsSchema.properties as Record<string, JSONSchema7>).jsonBody;
    expect(httpBody?.description).not.toContain('$fromAI');
  });

  it('os exemplos, em modo Expressão, viram os argumentos da ferramenta', () => {
    const schema = fromAISchema({
      url: `=${HTTP_TOOL_EXAMPLES.url}`,
      queryParameters: [{ name: 'cidade', value: `=${HTTP_TOOL_EXAMPLES.queryValue}` }],
      jsonBody: `=${HTTP_TOOL_EXAMPLES.jsonBody}`,
    });
    expect(schema).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Id do cliente' },
        cidade: { type: 'string', description: 'Nome da cidade' },
        dias: { type: 'number', description: 'Quantidade de dias' },
      },
      required: ['id', 'cidade'],
      additionalProperties: false,
    });
  });

  it('o exemplo do corpo produz JSON válido com os valores do modelo', () => {
    const values: Record<string, unknown> = { cidade: 'Recife', dias: 5 };
    const body = HTTP_TOOL_EXAMPLES.jsonBody.replace(
      /\{\{\s*\$fromAI\('(\w+)'[^}]*\}\}/g,
      (_, key: string) => String(values[key]),
    );
    expect(JSON.parse(body)).toEqual({ cidade: 'Recife', dias: 5 });
  });
});

describe('spec 011 — FR-007: exemplo na Ferramenta: código', () => {
  const codeProp = (name: string) =>
    (
      builtinNodes.find((n) => n.type === 'tool.code')?.paramsSchema.properties as Record<
        string,
        JSONSchema7
      >
    )[name];

  it('mostra o exemplo do schema e do código abaixo de cada campo', () => {
    expect(codeProp('inputSchema')?.description).toContain(CODE_TOOL_EXAMPLES.inputSchema);
    expect(codeProp('jsCode')?.description).toContain(CODE_TOOL_EXAMPLES.jsCode);
  });

  it('o código do exemplo usa os argumentos declarados no schema', () => {
    const schema = JSON.parse(CODE_TOOL_EXAMPLES.inputSchema) as { required: string[] };
    expect(schema.required).toEqual(['valor', 'parcelas']);
    // Só para conferir o exemplo; na plataforma o código roda no sandbox.
    const $input = { first: () => ({ json: { valor: 100, parcelas: 3 } }) };
    const result: unknown = runInNewContext(`(() => { ${CODE_TOOL_EXAMPLES.jsCode} })()`, {
      $input,
    });
    expect(result).toEqual({ parcela: 33.33 });
  });
});
