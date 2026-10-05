import { parseTemplate } from './template.js';

export interface NodeReferences {
  names: Set<string>;
  /** Referência com nome calculado em tempo de execução: o contexto precisa de todos os nós. */
  dynamic: boolean;
}

const LITERAL_CALL = /\$\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*\)/g;
const LEGACY_INDEX = /\$node\[\s*(['"`])((?:\\.|(?!\1).)*)\1\s*\]/g;
const LEGACY_DOT = /\$node\.([A-Za-z_$][\w$]*)/g;
const ANY_CALL = /\$\(/g;
const ANY_LEGACY = /\$node\b(?!\s*[.[]\s*['"`A-Za-z_$])/g;

/** Nós citados por `$('Nó')`, `$node["Nó"]` e `$node.Nó` (análise estática, plan §2). */
export function findNodeReferences(templates: string[]): NodeReferences {
  const refs: NodeReferences = { names: new Set<string>(), dynamic: false };
  for (const template of templates) {
    let code: string;
    try {
      code = parseTemplate(template.replace(/^=/, ''))
        .flatMap((s) => (s.type === 'code' ? [s.code] : []))
        .join('\n');
    } catch {
      continue;
    }
    scan(code, refs);
  }
  return refs;
}

/** Mesma análise sobre o código do nó `code.javascript` (spec 005). */
export function findCodeReferences(code: string): NodeReferences {
  const refs: NodeReferences = { names: new Set<string>(), dynamic: false };
  scan(code, refs);
  return refs;
}

function scan(code: string, refs: NodeReferences): void {
  let literalCalls = 0;
  for (const m of code.matchAll(LITERAL_CALL)) {
    refs.names.add(unescape(m[2] ?? ''));
    literalCalls++;
  }
  for (const m of code.matchAll(LEGACY_INDEX)) refs.names.add(unescape(m[2] ?? ''));
  for (const m of code.matchAll(LEGACY_DOT)) refs.names.add(m[1] ?? '');
  if ([...code.matchAll(ANY_CALL)].length > literalCalls) refs.dynamic = true;
  const legacyComputed =
    [...code.matchAll(/\$node\[/g)].length > [...code.matchAll(LEGACY_INDEX)].length;
  if (legacyComputed || ANY_LEGACY.test(code)) refs.dynamic = true;
  ANY_LEGACY.lastIndex = 0;
}

function unescape(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}
