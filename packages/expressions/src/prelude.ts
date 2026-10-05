/**
 * Código executado DENTRO do isolate, uma vez por contexto (execução). Implementa as variáveis
 * do N8N sobre `globalThis.__olly_data` (ExpressionData do lote atual). Nada aqui tem acesso
 * ao processo host: o isolate não expõe `require`, `process`, rede nem sistema de arquivos.
 */
export const PRELUDE_SOURCE = String.raw`
(function () {
  'use strict';
  const g = globalThis;
  const L = g.luxon;

  function deepFreeze(value, seen) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const key of Object.keys(value)) deepFreeze(value[key], seen);
    return Object.freeze(value);
  }

  function isLuxon(v) {
    return v instanceof L.DateTime || v instanceof L.Duration || v instanceof L.Interval;
  }

  // Resultado copiável para o host: datas viram ISO, funções somem, ciclos são cortados.
  function out(value, depth, seen) {
    depth = depth || 0;
    seen = seen || new Set();
    if (value === null || value === undefined) return value;
    if (typeof value === 'function' || typeof value === 'symbol') return undefined;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value !== 'object') return value;
    if (isLuxon(value)) return value.toISO();
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
    if (seen.has(value) || depth > 64) return '[Circular]';
    seen.add(value);
    let result;
    if (Array.isArray(value)) result = value.map((v) => out(v, depth + 1, seen));
    else {
      result = {};
      for (const key of Object.keys(value)) {
        const v = out(value[key], depth + 1, seen);
        if (v !== undefined) result[key] = v;
      }
    }
    seen.delete(value);
    return result;
  }

  // Trecho de template misto (FR-002): nulo e indefinido viram vazio; objetos, JSON.
  function str(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      if (isLuxon(value)) return value.toISO();
      if (value instanceof Date) return value.toISOString();
      return JSON.stringify(out(value));
    }
    return String(value);
  }

  function nodeApi(d, name, i) {
    const node = d.nodes[name];
    if (!node) throw new Error('Nó "' + name + '" não existe ou não foi incluído no contexto');
    const requireExecuted = () => {
      if (!node.executed) throw new Error('Nó "' + name + '" ainda não foi executado');
    };
    const branch = (b) => node.outputs[node.outputOrder[b || 0]] || [];
    const paired = (index) => {
      requireExecuted();
      const ref = (d.paired[index] || {})[name];
      if (!ref) throw new Error('Sem item correspondente em "' + name + '" para o item ' + index);
      if (ref.error) throw new Error(ref.error);
      return (node.outputs[ref.port] || [])[ref.index];
    };
    return {
      get item() { return paired(i); },
      itemMatching: (index) => paired(index),
      all: (b) => { requireExecuted(); return branch(b); },
      first: (b) => { requireExecuted(); return branch(b)[0]; },
      last: (b) => { requireExecuted(); const items = branch(b); return items[items.length - 1]; },
      get params() { return node.params; },
      get isExecuted() { return node.executed; },
    };
  }

  // Sintaxe legada $node["Nó"].json: item de mesmo índice na primeira saída.
  function legacyNode(d, i) {
    return new Proxy({}, {
      get(_, name) {
        if (typeof name !== 'string') return undefined;
        const node = d.nodes[name];
        if (!node) throw new Error('Nó "' + name + '" não existe ou não foi incluído no contexto');
        const item = (node.outputs[node.outputOrder[0]] || [])[i];
        return { json: item ? item.json : undefined, binary: item ? item.binary : undefined, parameter: node.params };
      },
    });
  }

  let cached = { data: null, index: -1, value: null };

  function ctx(i) {
    const d = g.__olly_data;
    if (cached.data === d && cached.index === i) return cached.value;
    const input = d.input;
    const item = input[i];
    const zone = d.timezone;
    const value = {
      $json: item ? item.json : {},
      $binary: (item && item.binary) || {},
      $itemIndex: i,
      $input: {
        item: item,
        all: () => input,
        first: () => input[0],
        last: () => input[input.length - 1],
        params: d.params,
      },
      $: (name) => nodeApi(d, String(name), i),
      $node: legacyNode(d, i),
      $vars: d.vars,
      $env: d.env,
      $execution: d.execution,
      $loop: d.loop,
      $workflow: d.workflow,
      $parameter: d.params,
      $now: L.DateTime.now().setZone(zone),
      $today: L.DateTime.now().setZone(zone).startOf('day'),
    };
    cached = { data: d, index: i, value: value };
    return value;
  }

  g.__olly_ctx = ctx;
  g.__olly_out = (v) => out(v);
  g.__olly_s = str;
  g.__olly_freeze = () => { deepFreeze(g.__olly_data, new Set()); };
  g.DateTime = L.DateTime;
  g.Duration = L.Duration;
  g.Interval = L.Interval;
})();
`;

/** Envolve o corpo compilado do template numa função de um argumento (índice do item). */
export function wrapTemplateFunction(body: string): string {
  return `(function (__olly_i) {
  const { $json, $binary, $itemIndex, $input, $, $node, $vars, $env, $execution, $loop, $workflow, $parameter, $now, $today } = __olly_ctx(__olly_i);
  ${body}
})`;
}
