/** Tipos das variáveis do N8N e dos nomes dos nós, para o autocomplete (FR-012). */
export function codeDeclarations(nodeNames: string[]): string {
  const names =
    nodeNames.length > 0 ? nodeNames.map((n) => JSON.stringify(n)).join(' | ') : 'string';
  return `
interface OllyItem { json: Record<string, any>; binary?: Record<string, any>; pairedItem?: unknown }
interface OllyNodeData {
  /** Item correspondente ao item atual. */ item: OllyItem;
  all(branch?: number): OllyItem[]; first(branch?: number): OllyItem; last(branch?: number): OllyItem;
  itemMatching(index: number): OllyItem; params: Record<string, any>; isExecuted: boolean;
}
/** Itens de entrada do nó. */
declare const $input: { all(): OllyItem[]; first(): OllyItem; last(): OllyItem; item: OllyItem; params: Record<string, any> };
/** JSON do item atual (modo "uma vez por item"). */ declare const $json: Record<string, any>;
declare const $binary: Record<string, any>;
declare const $itemIndex: number;
/** Dados de outro nó do workflow. */ declare function $(nodeName: ${names}): OllyNodeData;
declare const $vars: Record<string, any>;
declare const $env: Record<string, string>;
declare const $execution: { id: string; mode: 'test' | 'production' };
declare const $workflow: { id: string; name: string; active: boolean };
declare const $now: any; declare const $today: any; declare const DateTime: any;
/** lodash */ declare const _: any;
declare const items: OllyItem[]; declare const item: OllyItem;
`;
}
