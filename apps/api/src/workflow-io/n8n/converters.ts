import {
  collection,
  isObject,
  jsonObjectToPairs,
  list,
  num,
  pairsToObjectExpression,
  rl,
  str,
  versionIn,
  type Params,
} from './helpers.js';

/** Nó do JSON exportado pelo N8N (campos usados pela conversão). */
export interface N8nNode {
  id?: string;
  name: string;
  type: string;
  typeVersion?: number;
  position?: unknown;
  parameters?: Params;
  credentials?: Record<string, { id?: string; name?: string }>;
  disabled?: boolean;
  onError?: string;
  continueOnFail?: boolean;
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
  alwaysOutputData?: boolean;
  executeOnce?: boolean;
  notes?: string;
}

export interface Conversion {
  type: string;
  parameters: Params;
  warnings: string[];
  /** Tipo de credencial do N8N → tipo do Olly Flow, neste nó. */
  credentials?: Record<string, string>;
}
export type ConvertResult = Conversion | { unsupported: string };
type Converter = (node: N8nNode, p: Params, version: number) => ConvertResult;

const unsupportedVersion = (type: string, v: number): ConvertResult => ({
  unsupported: `${type} na versão ${String(v)} não tem conversão`,
});

// ---------------------------------------------------------------------------------------------
// Condições (If v2 / Switch v3: o "filter" do N8N; If v1: listas por tipo)
// ---------------------------------------------------------------------------------------------

const OPERATION_MAP: Record<string, string> = {
  equals: 'equals',
  notEquals: 'notEquals',
  contains: 'contains',
  notContains: 'notContains',
  startsWith: 'startsWith',
  endsWith: 'endsWith',
  regex: 'regex',
  empty: 'isEmpty',
  notEmpty: 'isNotEmpty',
  exists: 'isNotEmpty',
  notExists: 'isEmpty',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  true: 'true',
  false: 'false',
  after: 'after',
  before: 'before',
  afterOrEquals: 'after',
  beforeOrEquals: 'before',
  lengthEquals: 'lengthEquals',
};
const APPROXIMATE = new Set(['exists', 'notExists', 'afterOrEquals', 'beforeOrEquals']);
const TYPES = new Set(['string', 'number', 'boolean', 'dateTime', 'array', 'object']);

function convertFilter(
  filter: unknown,
  warnings: string[],
): { combinator: string; conditions: Params[] } {
  const f = isObject(filter) ? filter : {};
  const options = isObject(f.options) ? f.options : {};
  if (options.caseSensitive === false) {
    warnings.push(
      'Comparação sem diferenciar maiúsculas não existe: as condições diferenciam maiúsculas',
    );
  }
  const conditions = list(f.conditions)
    .filter(isObject)
    .map((c) => {
      const op = isObject(c.operator) ? c.operator : {};
      const type = TYPES.has(str(op.type)) ? str(op.type) : 'string';
      const original = str(op.operation, 'equals');
      const operation = OPERATION_MAP[original];
      if (!operation)
        warnings.push(`Operação "${original}" (${type}) não suportada: revise a condição`);
      else if (APPROXIMATE.has(original)) {
        warnings.push(
          `Operação "${original}" convertida para "${operation}" (aproximação): revise`,
        );
      }
      const right = c.rightValue;
      return {
        leftValue:
          typeof c.leftValue === 'string' ? c.leftValue : JSON.stringify(c.leftValue ?? ''),
        operator: { type, operation: operation ?? original },
        rightValue:
          typeof right === 'string' ? right : right === undefined ? '' : JSON.stringify(right),
      };
    });
  return { combinator: str(f.combinator) === 'or' ? 'or' : 'and', conditions };
}

const IF_V1_OPS: Record<string, Record<string, string>> = {
  string: {
    equal: 'equals',
    notEqual: 'notEquals',
    contains: 'contains',
    notContains: 'notContains',
    startsWith: 'startsWith',
    endsWith: 'endsWith',
    regex: 'regex',
    isEmpty: 'isEmpty',
    isNotEmpty: 'isNotEmpty',
  },
  number: {
    equal: 'equals',
    notEqual: 'notEquals',
    larger: 'gt',
    largerEqual: 'gte',
    smaller: 'lt',
    smallerEqual: 'lte',
    isEmpty: 'isEmpty',
    isNotEmpty: 'isNotEmpty',
  },
  boolean: { equal: 'equals', notEqual: 'notEquals' },
  dateTime: { after: 'after', before: 'before' },
};

function convertIfV1(p: Params, warnings: string[]) {
  const groups = isObject(p.conditions) ? p.conditions : {};
  const conditions: Params[] = [];
  for (const [type, ops] of Object.entries(IF_V1_OPS)) {
    for (const c of list(groups[type]).filter(isObject)) {
      const original = str(c.operation, type === 'dateTime' ? 'after' : 'equal');
      const operation = ops[original];
      if (!operation)
        warnings.push(`Operação "${original}" (${type}) não suportada: revise a condição`);
      conditions.push({
        leftValue: str(c.value1, JSON.stringify(c.value1 ?? '')),
        operator: { type, operation: operation ?? original },
        rightValue: str(c.value2, c.value2 === undefined ? '' : JSON.stringify(c.value2)),
      });
    }
  }
  return { combinator: str(p.combineOperation) === 'any' ? 'or' : 'and', conditions };
}

// ---------------------------------------------------------------------------------------------
// HTTP (Request v4 e a ferramenta do agente)
// ---------------------------------------------------------------------------------------------

const HTTP_AUTH: Record<string, string> = {
  httpBasicAuth: 'httpBasic',
  httpHeaderAuth: 'httpHeaderAuth',
  httpQueryAuth: 'httpQueryAuth',
  httpBearerAuth: 'httpBearer',
  oAuth2Api: 'oauth2ClientCredentials',
};

const pairs = (v: unknown) =>
  collection(v, 'parameters').map((x) => ({ name: str(x.name), value: x.value ?? '' }));

function convertHttpParams(
  p: Params,
  warnings: string[],
): { params: Params; credentials: Record<string, string> } {
  const out: Params = { method: str(p.method, 'GET'), url: str(p.url) };
  const credentials: Record<string, string> = {};
  const auth = str(p.authentication, 'none');
  if (auth === 'genericCredentialType') {
    const generic = str(p.genericAuthType);
    const mapped = HTTP_AUTH[generic];
    if (mapped) {
      out.authentication = 'credential';
      credentials[generic] = mapped;
      if (generic === 'oAuth2Api') {
        warnings.push('OAuth2: o Olly Flow suporta só "client credentials"; revise a credencial');
      }
    } else {
      out.authentication = 'none';
      warnings.push(`Autenticação "${generic}" não suportada: configure a autenticação de novo`);
    }
  } else if (auth === 'predefinedCredentialType') {
    out.authentication = 'none';
    warnings.push(
      `Credencial pré-definida do N8N (${str(p.nodeCredentialType)}): recadastre como token, cabeçalho ou OAuth2 e ligue ao nó`,
    );
  } else out.authentication = 'none';

  if (p.sendQuery === true) {
    if (str(p.specifyQuery, 'keypair') === 'keypair')
      out.queryParameters = pairs(p.queryParameters);
    else {
      const parsed = jsonObjectToPairs(p.jsonQuery);
      if (parsed) out.queryParameters = parsed;
      else warnings.push('Parâmetros de query em JSON com expressão: refaça como pares nome/valor');
    }
  }
  if (p.sendHeaders === true) {
    if (str(p.specifyHeaders, 'keypair') === 'keypair') out.headers = pairs(p.headerParameters);
    else {
      const parsed = jsonObjectToPairs(p.jsonHeaders);
      if (parsed) out.headers = parsed;
      else warnings.push('Cabeçalhos em JSON com expressão: refaça como pares nome/valor');
    }
  }
  if (p.sendBody === true) {
    out.sendBody = true;
    const contentType = str(p.contentType, 'json');
    const specify = str(p.specifyBody, 'keypair');
    if (contentType === 'json') {
      out.contentType = 'json';
      out.jsonBody =
        specify === 'json'
          ? str(p.jsonBody, '{}')
          : pairsToObjectExpression(
              pairs(p.bodyParameters).map((x) => ({ name: x.name, value: x.value })),
            );
    } else if (contentType === 'form-urlencoded' || contentType === 'multipart-form-data') {
      if (specify === 'string') {
        out.contentType = 'raw';
        out.rawBody = str(p.body);
        out.rawContentType = 'application/x-www-form-urlencoded';
      } else {
        out.contentType = contentType === 'multipart-form-data' ? 'multipart' : 'form-urlencoded';
        out.bodyParameters = collection(p.bodyParameters, 'parameters').map((x) =>
          str(x.parameterType) === 'formBinaryData'
            ? {
                name: str(x.name),
                value: str(x.inputDataFieldName, 'data'),
                parameterType: 'binary',
              }
            : { name: str(x.name), value: x.value ?? '', parameterType: 'text' },
        );
      }
    } else if (contentType === 'raw') {
      out.contentType = 'raw';
      out.rawBody = str(p.body);
      out.rawContentType = str(p.rawContentType, 'text/plain');
    } else if (contentType === 'binaryData') {
      out.contentType = 'binary';
      out.inputBinaryField = str(p.inputDataFieldName, 'data');
    } else warnings.push(`Tipo de corpo "${contentType}" não suportado: revise o corpo`);
  }
  const o = isObject(p.options) ? p.options : {};
  const options: Params = {};
  if (num(o.timeout) !== undefined) options.timeout = o.timeout;
  const redirect =
    isObject(o.redirect) && isObject(o.redirect.redirect) ? o.redirect.redirect : undefined;
  if (redirect) {
    if (typeof redirect.followRedirects === 'boolean')
      options.followRedirects = redirect.followRedirects;
    if (num(redirect.maxRedirects) !== undefined) options.maxRedirects = redirect.maxRedirects;
  }
  const response =
    isObject(o.response) && isObject(o.response.response) ? o.response.response : undefined;
  if (response) {
    if (typeof response.fullResponse === 'boolean') options.fullResponse = response.fullResponse;
    if (typeof response.neverError === 'boolean') options.neverError = response.neverError;
    const format = str(response.responseFormat);
    const map: Record<string, string> = {
      autodetect: 'auto',
      json: 'json',
      text: 'text',
      file: 'binary',
    };
    if (map[format]) options.responseFormat = map[format];
    if (str(response.outputPropertyName))
      options.outputBinaryField = str(response.outputPropertyName);
  }
  const batch = isObject(o.batching) && isObject(o.batching.batch) ? o.batching.batch : undefined;
  if (batch) {
    if (num(batch.batchSize) !== undefined && Number(batch.batchSize) > 0)
      options.batchSize = batch.batchSize;
    if (num(batch.batchInterval) !== undefined) options.batchIntervalMs = batch.batchInterval;
  }
  if (o.allowUnauthorizedCerts === true)
    warnings.push('Ignorar certificado inválido não é suportado');
  if (o.proxy) warnings.push('Proxy por nó não é suportado');
  out.options = options;
  return { params: out, credentials };
}

/** `{nome}` da Ferramenta HTTP antiga do N8N → `$fromAI('nome', ...)`. */
function withFromAI(
  value: unknown,
  defs: Map<string, { description: string; type: string }>,
): unknown {
  if (typeof value !== 'string' || !/\{[A-Za-z0-9_-]+\}/.test(value)) return value;
  const expression = value.startsWith('=');
  const body = (expression ? value.slice(1) : value).replace(
    /(?<!\{)\{([A-Za-z0-9_-]+)\}(?!\})/g,
    (whole, name: string) => {
      const def = defs.get(name);
      if (!def && defs.size > 0) return whole;
      const type =
        def?.type === 'number' || def?.type === 'boolean' || def?.type === 'json'
          ? def.type
          : 'string';
      return `{{ $fromAI(${JSON.stringify(name)}, ${JSON.stringify(def?.description ?? '')}, ${JSON.stringify(type)}) }}`;
    },
  );
  return `=${body}`;
}

// ---------------------------------------------------------------------------------------------
// Conversores por tipo
// ---------------------------------------------------------------------------------------------

const ok = (
  type: string,
  parameters: Params,
  warnings: string[] = [],
  credentials?: Record<string, string>,
): Conversion => ({
  type,
  parameters,
  warnings,
  ...(credentials && Object.keys(credentials).length > 0 && { credentials }),
});

const SET_TYPES: Record<string, string> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  array: 'json',
  object: 'json',
  stringValue: 'string',
  numberValue: 'number',
  booleanValue: 'boolean',
  arrayValue: 'json',
  objectValue: 'json',
};

const convertSet: Converter = (_node, p, v) => {
  const warnings: string[] = [];
  const options = isObject(p.options) ? p.options : {};
  if (options.dotNotation === false)
    warnings.push(
      '"Notação de ponto" desligada não existe: nomes com ponto viram campos aninhados',
    );
  if (v >= 3) {
    if (str(p.mode, 'manual') === 'raw')
      return { unsupported: 'Set em modo JSON (raw) não tem conversão' };
    let fields: Params[];
    if (v >= 3.3) {
      fields = collection(p.assignments, 'assignments').map((a) => ({
        name: str(a.name),
        type: SET_TYPES[str(a.type, 'string')] ?? 'string',
        value: typeof a.value === 'string' ? a.value : JSON.stringify(a.value ?? ''),
      }));
    } else {
      fields = collection(p.fields, 'values').map((f) => {
        const type = str(f.type, 'stringValue');
        const value = f[type];
        return {
          name: str(f.name),
          type: SET_TYPES[type] ?? 'string',
          value: typeof value === 'string' ? value : JSON.stringify(value ?? ''),
        };
      });
    }
    let includeOtherFields = p.includeOtherFields === true;
    if (v < 3.3 && p.include !== undefined) {
      const include = str(p.include, 'none');
      includeOtherFields = include !== 'none';
      if (include === 'selected' || include === 'except') {
        warnings.push(
          `Incluir campos "${include}" não existe: todos os demais campos são incluídos`,
        );
      }
    } else if (includeOtherFields && str(p.include, 'all') !== 'all') {
      warnings.push(
        `Incluir campos "${str(p.include)}" não existe: todos os demais campos são incluídos`,
      );
    }
    return ok('data.set', { fields, includeOtherFields }, warnings);
  }
  const values = isObject(p.values) ? p.values : {};
  const fields: Params[] = [];
  for (const type of ['string', 'number', 'boolean']) {
    for (const f of list(values[type]).filter(isObject)) {
      fields.push({
        name: str(f.name),
        type,
        value: typeof f.value === 'string' ? f.value : JSON.stringify(f.value ?? ''),
      });
    }
  }
  return ok('data.set', { fields, includeOtherFields: p.keepOnlySet !== true }, warnings);
};

const convertIf: Converter = (_node, p, v) => {
  const warnings: string[] = [];
  if (v >= 2) {
    const options = isObject(p.options) ? p.options : {};
    const filterOptions =
      isObject(p.conditions) && isObject(p.conditions.options) ? p.conditions.options : {};
    const loose =
      p.looseTypeValidation === true ||
      options.looseTypeValidation === true ||
      filterOptions.typeValidation === 'loose';
    return ok(
      'logic.if',
      { conditions: convertFilter(p.conditions, warnings), looseTypeValidation: loose },
      warnings,
    );
  }
  return ok(
    'logic.if',
    { conditions: convertIfV1(p, warnings), looseTypeValidation: true },
    warnings,
  );
};

const convertSwitch: Converter = (node, p, v) => {
  if (!versionIn(v, 3, 3.99)) return unsupportedVersion(node.type, v);
  const warnings: string[] = [];
  const options = isObject(p.options) ? p.options : {};
  if (options.ignoreCase === true)
    warnings.push('Ignorar maiúsculas não existe: as regras diferenciam maiúsculas');
  if (str(p.mode, 'rules') === 'expression') {
    return ok(
      'logic.switch',
      {
        mode: 'expression',
        numberOutputs: num(p.numberOutputs) ?? 4,
        output: str(p.output, '={{ 0 }}'),
      },
      warnings,
    );
  }
  const rules = collection(p.rules, 'values').map((r) => ({
    conditions: convertFilter(r.conditions, warnings),
    outputKey: r.renameOutput === true ? str(r.outputKey) : '',
  }));
  const fallback = options.fallbackOutput;
  return ok(
    'logic.switch',
    {
      mode: 'rules',
      rules,
      looseTypeValidation: options.looseTypeValidation === true || p.looseTypeValidation === true,
      options: {
        fallbackOutput: fallback === 'extra' || typeof fallback === 'number' ? fallback : 'none',
        allMatchingOutputs: options.allMatchingOutputs === true,
      },
    },
    warnings,
  );
};

const JOIN_MODES: Record<string, string> = {
  keepMatches: 'inner',
  enrichInput1: 'left',
  keepEverything: 'outer',
  keepNonMatches: 'keepNonMatches',
};
const CLASH: Record<string, string> = {
  preferLast: 'preferLast',
  preferInput1: 'preferInput1',
  addSuffix: 'addSuffix',
};

function mergeFields(p: Params): Params[] {
  const advanced = collection(p.mergeByFields, 'values');
  if (advanced.length > 0)
    return advanced.map((f) => ({ input1Field: str(f.field1), input2Field: str(f.field2) }));
  return str(p.fieldsToMatchString)
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => ({ input1Field: f, input2Field: f }));
}

const convertMerge: Converter = (_node, p, v) => {
  const warnings: string[] = [];
  const options = isObject(p.options) ? p.options : {};
  const clashRaw =
    isObject(options.clashHandling) && isObject(options.clashHandling.values)
      ? str(options.clashHandling.values.resolveClash)
      : '';
  const clash = CLASH[clashRaw] ?? 'preferLast';
  if (clashRaw === 'preferInput2')
    warnings.push('"Preferir entrada 2" convertido para "preferir a última"');
  if (v >= 2) {
    const mode = str(p.mode, 'append');
    const numberInputs = Math.min(10, Math.max(2, num(p.numberInputs) ?? 2));
    if (mode === 'append') return ok('logic.merge', { mode: 'append', numberInputs }, warnings);
    if (mode === 'chooseBranch') {
      const output = str(p.output, v >= 3 ? 'specifiedInput' : 'input1');
      if (output === 'empty')
        return ok('logic.merge', { mode: 'chooseBranch', numberInputs, output: 'empty' }, warnings);
      const chosen = v >= 3 ? (num(p.useDataOfInput) ?? 1) : output === 'input2' ? 2 : 1;
      return ok(
        'logic.merge',
        { mode: 'chooseBranch', numberInputs, output: 'input', chosenInput: chosen },
        warnings,
      );
    }
    const by =
      v >= 3 ? str(p.combineBy, 'combineByFields') : str(p.combinationMode, 'mergeByFields');
    if (mode === 'combine' && (by === 'combineByPosition' || by === 'mergeByPosition')) {
      return ok(
        'logic.merge',
        {
          mode: 'combineByPosition',
          numberInputs,
          includeUnpaired: options.includeUnpaired === true,
          clashHandling: clash,
        },
        warnings,
      );
    }
    if (mode === 'combine' && (by === 'combineByFields' || by === 'mergeByFields')) {
      const join = str(p.joinMode, 'keepMatches');
      if (!JOIN_MODES[join]) warnings.push(`Modo de junção "${join}" convertido para "left"`);
      return ok(
        'logic.merge',
        {
          mode: 'combineByFields',
          numberInputs: 2,
          fields: mergeFields(p),
          joinMode: JOIN_MODES[join] ?? 'left',
          clashHandling: clash,
        },
        warnings,
      );
    }
    return { unsupported: `Merge no modo "${mode}"${by ? ` / "${by}"` : ''} não tem conversão` };
  }
  const mode = str(p.mode, 'append');
  if (mode === 'append') return ok('logic.merge', { mode: 'append', numberInputs: 2 }, warnings);
  if (mode === 'mergeByIndex')
    return ok(
      'logic.merge',
      { mode: 'combineByPosition', numberInputs: 2, clashHandling: clash },
      warnings,
    );
  if (mode === 'mergeByKey') {
    return ok(
      'logic.merge',
      {
        mode: 'combineByFields',
        numberInputs: 2,
        fields: [{ input1Field: str(p.propertyName1), input2Field: str(p.propertyName2) }],
        joinMode: 'left',
        clashHandling: clash,
      },
      warnings,
    );
  }
  if (mode === 'wait') return ok('logic.merge', { mode: 'waitAll', numberInputs: 2 }, warnings);
  if (mode === 'passThrough') {
    return ok(
      'logic.merge',
      {
        mode: 'chooseBranch',
        numberInputs: 2,
        output: 'input',
        chosenInput: str(p.output) === 'input2' ? 2 : 1,
      },
      warnings,
    );
  }
  return { unsupported: `Merge v1 no modo "${mode}" não tem conversão` };
};

const convertSplitInBatches: Converter = (_node, p, v) => {
  if (v < 3)
    return {
      unsupported: 'Split in Batches anterior à versão 3 não tem conversão (use o Loop Over Items)',
    };
  const warnings: string[] = [];
  const options = isObject(p.options) ? p.options : {};
  if (options.reset) warnings.push('A opção "reset" do Loop Over Items não existe');
  return ok('logic.loopOverItems', { batchSize: num(p.batchSize) ?? 1 }, warnings);
};

const convertCode: Converter = (_node, p, v) => {
  const language = str(p.language, 'javaScript');
  if (v >= 2 && language !== 'javaScript')
    return { unsupported: 'Código Python ainda não está disponível no Olly Flow' };
  return ok('code.javascript', {
    mode:
      str(p.mode, 'runOnceForAllItems') === 'runOnceForEachItem'
        ? 'runOnceForEachItem'
        : 'runOnceForAllItems',
    jsCode: str(p.jsCode),
  });
};

const convertHttpRequest: Converter = (node, p, v) => {
  if (v < 4) return unsupportedVersion(node.type, v);
  const warnings: string[] = [];
  const { params, credentials } = convertHttpParams(p, warnings);
  return ok('http.request', params, warnings, credentials);
};

const convertPostgres: Converter = (node, p, v) => {
  const warnings: string[] = [];
  const operation = str(p.operation, v >= 2 ? 'insert' : 'insert');
  const credentials = { postgres: 'postgres' };
  if (operation === 'executeQuery') {
    const options = isObject(p.options) ? p.options : {};
    const replacement = str(options.queryReplacement ?? p.additionalFields);
    const values = replacement
      ? replacement.startsWith('=') && !replacement.includes(',')
        ? [replacement]
        : replacement.split(',').map((s) => s.trim())
      : [];
    if (replacement.includes('{{') && replacement.includes(',')) {
      warnings.push(
        'Parâmetros da consulta separados por vírgula com expressões: confira cada $1, $2...',
      );
    }
    return ok(
      'postgres.query',
      {
        query: str(p.query),
        queryParameters: values.map((value) => ({ value })),
        mode: values.length > 0 ? 'perItem' : 'once',
      },
      warnings,
      credentials,
    );
  }
  if (v < 2) return unsupportedVersion(node.type, v);
  if (operation === 'insert' || operation === 'update' || operation === 'upsert') {
    const columns = isObject(p.columns) ? p.columns : {};
    const defineBelow = str(columns.mappingMode, 'defineBelow') === 'defineBelow';
    const value = isObject(columns.value) ? columns.value : {};
    const options = isObject(p.options) ? p.options : {};
    const params: Params = {
      operation,
      schema: rl(p.schema) || 'public',
      table: rl(p.table),
      columns: defineBelow
        ? {
            mappingMode: 'defineBelow',
            values: Object.entries(value).map(([column, v2]) => ({
              column,
              value: typeof v2 === 'string' ? v2 : JSON.stringify(v2 ?? ''),
            })),
          }
        : { mappingMode: 'autoMap', values: [] },
      matchingColumns: list(columns.matchingColumns).map((c) => ({ column: str(c) })),
      options: {
        ...(str(options.queryBatching) === 'transaction' && { transaction: 'allItems' }),
        ...(options.skipOnConflict === true && { skipOnConflict: true }),
      },
    };
    if (options.outputColumns)
      warnings.push('"Colunas de saída" não convertidas: a gravação devolve todas (*)');
    return ok('postgres.write', params, warnings, credentials);
  }
  return { unsupported: `PostgreSQL na operação "${operation}" não tem conversão` };
};

const convertWebhook: Converter = (_node, p) => {
  const warnings: string[] = [];
  const methodRaw = p.httpMethod;
  const method = Array.isArray(methodRaw) ? str(methodRaw[0], 'GET') : str(methodRaw, 'GET');
  if (Array.isArray(methodRaw) && methodRaw.length > 1)
    warnings.push(`Vários métodos (${methodRaw.join(', ')}): só ${method} foi mantido`);
  const auth = str(p.authentication, 'none');
  const credentials: Record<string, string> = {};
  let authentication = 'none';
  if (auth === 'basicAuth') {
    authentication = 'basicAuth';
    credentials.httpBasicAuth = 'webhookBasicAuth';
  } else if (auth === 'headerAuth') {
    authentication = 'headerAuth';
    credentials.httpHeaderAuth = 'webhookHeaderAuth';
  } else if (auth !== 'none')
    warnings.push(
      `Autenticação "${auth}" do webhook não suportada: configure a autenticação de novo`,
    );
  let responseMode = str(p.responseMode, 'onReceived');
  if (!['onReceived', 'lastNode', 'responseNode'].includes(responseMode)) {
    warnings.push(`Modo de resposta "${responseMode}" convertido para "onReceived"`);
    responseMode = 'onReceived';
  }
  const o = isObject(p.options) ? p.options : {};
  for (const k of [
    'responseCode',
    'responseData',
    'responseHeaders',
    'rawBody',
    'binaryData',
    'noResponseBody',
    'responsePropertyName',
  ]) {
    if (o[k] !== undefined) warnings.push(`Opção "${k}" do webhook não convertida`);
  }
  return ok(
    'trigger.webhook',
    {
      httpMethod: method.toUpperCase(),
      path: str(p.path).replace(/^\/+|\/+$/g, ''),
      authentication,
      responseMode,
      options: {
        ...(str(o.allowedOrigins) && { allowedOrigins: str(o.allowedOrigins) }),
        ...(str(o.ipWhitelist) && { ipAllowlist: str(o.ipWhitelist) }),
      },
    },
    warnings,
    credentials,
  );
};

const convertRespondToWebhook: Converter = (_node, p) => {
  const warnings: string[] = [];
  const options = isObject(p.options) ? p.options : {};
  const headers = collection(options.responseHeaders, 'entries').map((h) => ({
    name: str(h.name),
    value: str(h.value),
  }));
  const code = num(options.responseCode) ?? 200;
  const respondWith = str(p.respondWith, 'firstIncomingItem');
  const base = { responseCode: code, responseHeaders: headers };
  if (options.responseKey) warnings.push('"Colocar a resposta num campo" não convertido');
  switch (respondWith) {
    case 'firstIncomingItem':
      return ok('http.respondToWebhook', { respondWith: 'firstItemJson', ...base }, warnings);
    case 'allIncomingItems':
      return ok('http.respondToWebhook', { respondWith: 'allItemsJson', ...base }, warnings);
    case 'noData':
      return ok('http.respondToWebhook', { respondWith: 'noData', ...base }, warnings);
    case 'text':
      return ok(
        'http.respondToWebhook',
        { respondWith: 'text', responseBody: str(p.responseBody), ...base },
        warnings,
      );
    case 'json': {
      if (!headers.some((h) => h.name.toLowerCase() === 'content-type')) {
        headers.push({ name: 'Content-Type', value: 'application/json' });
      }
      warnings.push(
        'Resposta "JSON" convertida para texto com Content-Type application/json: revise o corpo',
      );
      const body = p.responseBody;
      return ok(
        'http.respondToWebhook',
        {
          respondWith: 'text',
          responseBody: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
          ...base,
        },
        warnings,
      );
    }
    case 'binary':
      return ok(
        'http.respondToWebhook',
        { respondWith: 'binary', binaryProperty: str(p.inputDataFieldName, 'data'), ...base },
        warnings,
      );
    case 'redirect':
      return ok(
        'http.respondToWebhook',
        {
          respondWith: 'noData',
          responseCode: 302,
          responseHeaders: [...headers, { name: 'Location', value: str(p.redirectURL) }],
        },
        warnings,
      );
    default:
      return { unsupported: `Responder com "${respondWith}" não tem conversão` };
  }
};

const convertExecuteWorkflow: Converter = (_node, p) => {
  const source = str(p.source, 'database');
  if (source !== 'database')
    return { unsupported: `Executar workflow pela origem "${source}" não tem conversão` };
  const options = isObject(p.options) ? p.options : {};
  return ok(
    'flow.executeWorkflow',
    {
      workflowId: rl(p.workflowId),
      mode: str(p.mode, 'once') === 'each' ? 'perItem' : 'once',
      waitForCompletion: options.waitForSubWorkflow !== false,
    },
    ['O workflow chamado precisa ser importado e escolhido de novo (ids do N8N não valem aqui)'],
  );
};

const convertExecuteWorkflowTrigger: Converter = (_node, p) => {
  const warnings: string[] = [];
  const inputs = collection(p.workflowInputs, 'values');
  let inputSchema = '';
  if (str(p.inputSource) === 'workflowInputs' && inputs.length > 0) {
    const types: Record<string, string> = {
      string: 'string',
      number: 'number',
      boolean: 'boolean',
      array: 'array',
      object: 'object',
    };
    inputSchema = JSON.stringify({
      type: 'object',
      properties: Object.fromEntries(
        inputs.map((i) => [str(i.name), types[str(i.type)] ? { type: types[str(i.type)] } : {}]),
      ),
    });
  } else if (str(p.inputSource) === 'jsonExample')
    warnings.push('Entrada definida por exemplo JSON: descreva o schema em "inputSchema"');
  return ok('trigger.executeWorkflow', { inputSchema }, warnings);
};

const convertWait: Converter = (_node, p) => {
  const resume = str(p.resume, 'timeInterval');
  if (resume === 'timeInterval') {
    const unit = str(p.unit, 'hours');
    return ok('flow.wait', {
      resume,
      amount: num(p.amount) ?? 1,
      unit: ['seconds', 'minutes', 'hours', 'days'].includes(unit) ? unit : 'hours',
    });
  }
  if (resume === 'specificTime') return ok('flow.wait', { resume, dateTime: str(p.dateTime) });
  return {
    unsupported: `Esperar "${resume}" (retomada por webhook ou formulário) não tem conversão`,
  };
};

const convertAgent: Converter = (_node, p) => {
  const warnings: string[] = [];
  const kind = str(p.agent);
  if (kind && kind !== 'toolsAgent' && kind !== 'conversationalAgent')
    warnings.push(`Agente do tipo "${kind}" convertido para o agente com ferramentas`);
  const options = isObject(p.options) ? p.options : {};
  if (p.hasOutputParser === true)
    warnings.push('Output parser não convertido: use "Formato da saída: JSON Schema" no Agent');
  const define = str(p.promptType, kind ? 'define' : 'auto') === 'define';
  return ok(
    'ai.agent',
    {
      promptSource: define ? 'define' : 'fromInput',
      ...(define && { text: str(p.text) }),
      systemMessage: str(options.systemMessage, 'Você é um assistente útil.'),
      maxIterations: num(options.maxIterations) ?? 10,
      returnIntermediateSteps: options.returnIntermediateSteps === true,
    },
    warnings,
  );
};

function chatModel(credentialType: string, ollyType: string, modelKey: string): Converter {
  return (_node, p) => {
    const options = isObject(p.options) ? p.options : {};
    const maxTokens = num(
      options.maxTokens ?? options.maxTokensToSample ?? options.maxOutputTokens,
    );
    return ok(
      'ai.chatModel',
      {
        model: rl(p[modelKey]),
        ...(num(options.temperature) !== undefined && { temperature: options.temperature }),
        ...(num(options.topP) !== undefined && { topP: options.topP }),
        maxTokens: maxTokens !== undefined && maxTokens > 0 ? maxTokens : 0,
        timeoutMs: num(options.timeout) ?? 60_000,
        maxRetries: num(options.maxRetries) ?? 2,
      },
      ['O modelo precisa estar liberado em Administração › IA'],
      { [credentialType]: ollyType },
    );
  };
}

function memory(type: 'memory.buffer' | 'memory.postgres'): Converter {
  return (_node, p) => {
    const warnings: string[] = [];
    if (type === 'memory.postgres')
      warnings.push(
        'A memória persistente usa o banco da plataforma: a credencial e a tabela do N8N não são usadas',
      );
    const custom = str(p.sessionIdType) === 'customKey' || (!p.sessionIdType && str(p.sessionKey));
    return ok(
      type,
      {
        sessionKey: custom ? str(p.sessionKey) : '={{ $json.sessionId }}',
        contextWindowLength: num(p.contextWindowLength) ?? 5,
      },
      warnings,
    );
  };
}

const toolBase = (node: N8nNode, description: unknown, warnings: string[]) => {
  const text = str(description).trim();
  if (!text)
    warnings.push('Ferramenta sem descrição: escreva o que ela faz em "Descrição para o modelo"');
  return {
    toolName: '',
    toolDescription: text || `Ferramenta ${node.name}`,
    requireApproval: false,
  };
};

const convertToolHttpRequest: Converter = (node, p) => {
  const warnings: string[] = [];
  const defs = new Map(
    collection(p.placeholderDefinitions, 'values').map((d) => [
      str(d.name),
      { description: str(d.description), type: str(d.type, 'string') },
    ]),
  );
  const fromModel = (x: Params) => {
    const provider = str(x.valueProvider, 'modelRequired');
    if (provider === 'fieldValue') return x.value ?? '';
    return `={{ $fromAI(${JSON.stringify(str(x.name))}, '', 'string'${provider === 'modelOptional' ? ", ''" : ''}) }}`;
  };
  const params: Params = {
    ...toolBase(node, p.toolDescription, warnings),
    method: str(p.method, 'GET'),
    url: withFromAI(str(p.url), defs),
    authentication: 'none',
  };
  const credentials: Record<string, string> = {};
  if (str(p.authentication) === 'genericCredentialType' && HTTP_AUTH[str(p.genericAuthType)]) {
    params.authentication = 'credential';
    credentials[str(p.genericAuthType)] = HTTP_AUTH[str(p.genericAuthType)] as string;
  } else if (str(p.authentication, 'none') !== 'none')
    warnings.push('Autenticação da ferramenta não convertida: configure-a de novo');
  if (p.sendQuery === true)
    params.queryParameters = collection(p.parametersQuery, 'values').map((x) => ({
      name: str(x.name),
      value: fromModel(x),
    }));
  if (p.sendHeaders === true)
    params.headers = collection(p.parametersHeaders, 'values').map((x) => ({
      name: str(x.name),
      value: fromModel(x),
    }));
  if (p.sendBody === true) {
    params.sendBody = true;
    params.contentType = 'json';
    params.jsonBody =
      str(p.specifyBody) === 'json'
        ? withFromAI(str(p.jsonBody, '{}'), defs)
        : pairsToObjectExpression(
            collection(p.parametersBody, 'values').map((x) => ({
              name: str(x.name),
              value: fromModel(x),
            })),
          );
  }
  for (const k of ['specifyQuery', 'specifyHeaders'])
    if (str(p[k]) === 'model')
      warnings.push(`"${k}" definido pelo modelo não existe: use $fromAI em cada valor`);
  return ok('tool.httpRequest', params, warnings, credentials);
};

const convertHttpRequestTool: Converter = (node, p) => {
  const warnings: string[] = [];
  const { params, credentials } = convertHttpParams(p, warnings);
  return ok(
    'tool.httpRequest',
    { ...toolBase(node, p.toolDescription, warnings), ...params },
    warnings,
    credentials,
  );
};

function schemaFromExample(text: string): string | undefined {
  try {
    const example = JSON.parse(text) as unknown;
    if (!isObject(example)) return undefined;
    const typeOf = (v: unknown) =>
      Array.isArray(v)
        ? 'array'
        : v === null
          ? 'string'
          : typeof v === 'object'
            ? 'object'
            : typeof v;
    return JSON.stringify({
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(example).map(([k, v]) => [k, { type: typeOf(v) }]),
      ),
      required: Object.keys(example),
    });
  } catch {
    return undefined;
  }
}

const convertToolCode: Converter = (node, p) => {
  if (str(p.language, 'javaScript') !== 'javaScript')
    return { unsupported: 'Ferramenta de código em Python ainda não está disponível' };
  const warnings = [
    'A ferramenta recebe os argumentos em $input.first().json: a variável "query" do N8N foi recriada no início do código; revise',
  ];
  const specified = p.specifyInputSchema === true;
  const schema = specified
    ? str(p.schemaType, 'fromJson') === 'manual'
      ? str(p.inputSchema)
      : schemaFromExample(str(p.jsonSchemaExample))
    : undefined;
  const base = toolBase(node, p.description, warnings);
  return ok(
    'tool.code',
    {
      ...base,
      toolName: str(p.name),
      inputSchema:
        schema ?? '{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}',
      jsCode: `const query = $input.first().json${schema ? '' : '.query'};\n${str(p.jsCode)}`,
    },
    warnings,
  );
};

const convertToolWorkflow: Converter = (node, p) => {
  const warnings = [
    'O workflow chamado precisa ser importado e escolhido de novo (ids do N8N não valem aqui)',
  ];
  if (str(p.source, 'database') !== 'database')
    return {
      unsupported: 'Ferramenta de workflow com o workflow definido no próprio nó não tem conversão',
    };
  return ok(
    'tool.workflow',
    {
      ...toolBase(node, p.description, warnings),
      toolName: str(p.name),
      workflowId: rl(p.workflowId),
    },
    warnings,
  );
};

const convertMcpClientTool: Converter = (_node, p) => {
  const warnings = [
    `Escolha o servidor MCP do catálogo (endereço no N8N: ${str(p.endpointUrl ?? p.sseEndpoint, '?')})`,
  ];
  const include = str(p.include, 'all');
  if (include === 'except')
    warnings.push(
      '"Todas exceto" não existe: todas as tools liberadas no projeto ficam disponíveis',
    );
  return ok(
    'tool.mcp',
    {
      serverId: '',
      tools: include === 'selected' ? 'selected' : 'allowed',
      toolNames: list(p.includeTools).map((name) => ({ name: str(name) })),
    },
    warnings,
  );
};

const simple =
  (type: string, parameters: Params = {}): Converter =>
  () =>
    ok(type, parameters);

/** Conversores por tipo do N8N (tabela da ADR-0001, plan §4). */
export const CONVERTERS: Record<string, Converter> = {
  'n8n-nodes-base.manualTrigger': simple('trigger.manual'),
  'n8n-nodes-base.errorTrigger': simple('trigger.error'),
  'n8n-nodes-base.webhook': convertWebhook,
  'n8n-nodes-base.executeWorkflowTrigger': convertExecuteWorkflowTrigger,
  'n8n-nodes-base.set': convertSet,
  'n8n-nodes-base.if': convertIf,
  'n8n-nodes-base.switch': convertSwitch,
  'n8n-nodes-base.merge': convertMerge,
  'n8n-nodes-base.splitInBatches': convertSplitInBatches,
  'n8n-nodes-base.noOp': simple('data.set', { fields: [], includeOtherFields: true }),
  'n8n-nodes-base.code': convertCode,
  'n8n-nodes-base.httpRequest': convertHttpRequest,
  'n8n-nodes-base.httpRequestTool': convertHttpRequestTool,
  'n8n-nodes-base.postgres': convertPostgres,
  'n8n-nodes-base.respondToWebhook': convertRespondToWebhook,
  'n8n-nodes-base.executeWorkflow': convertExecuteWorkflow,
  'n8n-nodes-base.wait': convertWait,
  '@n8n/n8n-nodes-langchain.agent': convertAgent,
  '@n8n/n8n-nodes-langchain.lmChatOpenAi': chatModel('openAiApi', 'openAiCompatible', 'model'),
  '@n8n/n8n-nodes-langchain.lmChatAnthropic': chatModel('anthropicApi', 'anthropic', 'model'),
  '@n8n/n8n-nodes-langchain.lmChatGoogleGemini': chatModel(
    'googlePalmApi',
    'googleGemini',
    'modelName',
  ),
  '@n8n/n8n-nodes-langchain.memoryBufferWindow': memory('memory.buffer'),
  '@n8n/n8n-nodes-langchain.memoryPostgresChat': memory('memory.postgres'),
  '@n8n/n8n-nodes-langchain.toolHttpRequest': convertToolHttpRequest,
  '@n8n/n8n-nodes-langchain.toolCode': convertToolCode,
  '@n8n/n8n-nodes-langchain.toolWorkflow': convertToolWorkflow,
  '@n8n/n8n-nodes-langchain.mcpClientTool': convertMcpClientTool,
};

/** Tipos descartados na importação (sem efeito na execução). */
export const DROPPED_TYPES = new Set(['n8n-nodes-base.stickyNote']);
